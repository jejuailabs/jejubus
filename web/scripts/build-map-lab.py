# 지도 실험 화면용 노선 모양: OSM 도로망에서 정류장 사이 도로 경로를 미리 계산한다.
# 입력: public/data/network.json + Overpass로 받은 제주 도로 JSON(저장소에 넣지 않음)
# 출력: public/data/map-lab-shapes.json
# 실행: python -I scripts/build-map-lab.py <network.json> <도로.json> <출력.json>
# 도로 받기(Overpass): (way["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$|^(unclassified|residential|living_street|service|road|busway)$"](33.15,126.10,33.60,127.00);
#   way["highway"~"^(primary|secondary|tertiary|unclassified|residential|service|road)$"](33.92,126.27,33.98,126.35););out body;>;out skel qt;
# 도로 데이터 출처: © OpenStreetMap contributors (ODbL). 화면에 출처를 표시해야 한다.
import collections, json, math, re, sys, time
import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

NET, ROADS, OUT = sys.argv[1:4]
KX, KY = 92900.0, 111000.0
FACTOR = {'motorway': 1, 'motorway_link': 1, 'trunk': 1, 'trunk_link': 1, 'primary': 1, 'primary_link': 1, 'secondary': 1, 'secondary_link': 1,
          'tertiary': 1, 'tertiary_link': 1, 'busway': 0.9, 'unclassified': 1.15, 'road': 1.3, 'residential': 1.35, 'living_street': 1.5, 'service': 1.8}
SNAP_BIAS = {'service': 16, 'living_street': 12, 'residential': 7}
started = time.time()
net = json.load(open(NET, encoding='utf-8'))
stops = net['stops']
data = json.load(open(ROADS, encoding='utf-8'))
print('roads loaded', round(time.time() - started), 's')
coords = {e['id']: (e['lon'], e['lat']) for e in data['elements'] if e['type'] == 'node'}
ids = {k: i for i, k in enumerate(coords)}
xy = [coords[k] for k in coords]
seg_a, seg_b, seg_kind, seg_way = [], [], [], []
kinds = []
kind_index = {}
for e in data['elements']:
    if e['type'] != 'way':
        continue
    tags = e.get('tags', {})
    h = tags.get('highway')
    if h not in FACTOR or tags.get('access') in ('private', 'no') and tags.get('bus') != 'yes':
        continue
    one = tags.get('oneway')
    if tags.get('junction') in ('roundabout', 'circular') and one is None:
        one = 'yes'
    # 일방통행 값: 0 양방향, 1 정방향만, -1 역방향만. 버스 전용 예외는 양방향으로 본다.
    way = 0 if tags.get('oneway:bus') == 'no' or tags.get('busway') == 'opposite_lane' else 1 if one in ('yes', 'true', '1') else -1 if one == '-1' else 0
    key = kind_index.setdefault(h, len(kinds))
    if key == len(kinds):
        kinds.append(h)
    for a, b in zip(e['nodes'], e['nodes'][1:]):
        if a in ids and b in ids:
            seg_a.append(ids[a]); seg_b.append(ids[b]); seg_kind.append(key); seg_way.append(way)
A, B = np.array(seg_a), np.array(seg_b)
K, WAY = np.array(seg_kind), np.array(seg_way)
LL = np.array(xy, dtype=float)
XY = np.c_[(LL[:, 0] - 126.5) * KX, (LL[:, 1] - 33.4) * KY]
print('nodes', len(XY), 'segments', len(A))

# 1) 정류장을 가까운 도로 위에 올린다
sample_xy, sample_seg = [], []
for s, (a, b) in enumerate(zip(A, B)):
    L = float(np.hypot(*(XY[b] - XY[a])))
    n = max(int(L / 18), 1)
    for t in np.linspace(0, 1, n + 1):
        sample_xy.append(XY[a] + (XY[b] - XY[a]) * t)
        sample_seg.append(s)
sample_xy = np.array(sample_xy)
sample_seg = np.array(sample_seg)
tree = cKDTree(sample_xy)
stop_xy = np.array([[(s[4] - 126.5) * KX, (s[3] - 33.4) * KY] for s in stops])
snap = {}
far = 0
dist, idx = tree.query(stop_xy, k=24, distance_upper_bound=170)
for i in range(len(stops)):
    best = None
    for j in sorted({int(sample_seg[q]) for q in idx[i] if q < len(sample_seg)}):
        a, b = XY[A[j]], XY[B[j]]
        v = b - a
        t = float(np.clip(np.dot(stop_xy[i] - a, v) / max(np.dot(v, v), 1e-9), 0, 1))
        d = float(np.hypot(*(stop_xy[i] - (a + v * t))))
        score = d + SNAP_BIAS.get(kinds[K[j]], 0)
        if best is None or score < best[0]:
            best = (score, j, t, d)
    if best is None:
        far += 1
        continue
    snap[i] = best[1:]
print('snapped', len(snap), 'too far from road', far)

# 2) 도로 조각을 정류장 위치에서 나눈 방향 그래프
extra_xy, stop_node = [], {}
cuts = collections.defaultdict(list)
for i, (j, t, _) in snap.items():
    cuts[j].append((t, i))
N0 = len(XY)
from_nodes, to_nodes, weights, lengths, undirected = [], [], [], [], []


def add(a, b, way, factor):
    L = float(np.hypot(*(P(a) - P(b))))
    if way >= 0:
        from_nodes.append(a); to_nodes.append(b); weights.append(max(L * factor, .01)); lengths.append(L)
    if way <= 0:
        from_nodes.append(b); to_nodes.append(a); weights.append(max(L * factor, .01)); lengths.append(L)


def P(n):
    return XY[n] if n < N0 else extra_xy[n - N0]


for j in range(len(A)):
    f, way = FACTOR[kinds[K[j]]], int(WAY[j])
    if j not in cuts:
        add(int(A[j]), int(B[j]), way, f)
        continue
    prev, by_t = int(A[j]), {}
    a, b = XY[A[j]], XY[B[j]]
    for t, i in sorted(cuts[j]):
        key = round(t, 4)
        if key not in by_t:
            extra_xy.append(a + (b - a) * t)
            node = N0 + len(extra_xy) - 1
            by_t[key] = node
            add(prev, node, way, f)
            prev = node
        stop_node[i] = by_t[key]
    add(prev, int(B[j]), way, f)
ALL = np.vstack([XY, np.array(extra_xy)])
SIZE = len(ALL)
best_edge = {}
for a, b, w, L in zip(from_nodes, to_nodes, weights, lengths):
    if (a, b) not in best_edge or w < best_edge[(a, b)][0]:
        best_edge[(a, b)] = (w, L)
keys = np.array(list(best_edge.keys()))
vals = np.array(list(best_edge.values()))
G = csr_matrix((vals[:, 0], (keys[:, 0], keys[:, 1])), shape=(SIZE, SIZE))
print('graph nodes', SIZE, 'edges', len(keys), round(time.time() - started), 's')
# 일방통행 때문에 끊긴 구간을 위한 무방향 그래프
pairs = {}
for (a, b), (w, L) in best_edge.items():
    k = (min(a, b), max(a, b))
    if k not in pairs or w < pairs[k]:
        pairs[k] = w
k2 = np.array(list(pairs.keys()))
v2 = np.array(list(pairs.values()))
G2 = csr_matrix((np.r_[v2, v2], (np.r_[k2[:, 0], k2[:, 1]], np.r_[k2[:, 1], k2[:, 0]])), shape=(SIZE, SIZE))

# 3) 노선에 실제로 나오는 정류장 쌍마다 도로 경로
wanted = collections.defaultdict(set)
for v in net['variants']:
    for a, b in zip(v['stops'], v['stops'][1:]):
        if a != b:
            wanted[a].add(b)
pairs_total = sum(len(x) for x in wanted.values())
print('stop pairs', pairs_total)


def walk(pred, s, t):
    path, at, guard = [t], t, 0
    while at != s and guard < 200000:
        at = int(pred[at])
        if at < 0:
            return None
        path.append(at)
        guard += 1
    return path[::-1]


def length(path):
    pts = ALL[path]
    return float(np.hypot(*np.diff(pts, axis=0).T).sum())


def rdp(points, eps):
    keep = np.zeros(len(points), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p, q = points[a], points[b]
        v = q - p
        n = np.hypot(*v) or 1
        d = np.abs(v[0] * (points[a + 1:b, 1] - p[1]) - v[1] * (points[a + 1:b, 0] - p[0])) / n
        i = int(np.argmax(d))
        if d[i] > eps:
            m = a + 1 + i
            keep[m] = True
            stack += [(a, m), (m, b)]
    return points[keep]


def lnglat(p):
    return p[0] / KX + 126.5, p[1] / KY + 33.4


segs, road, retried, straight, ratios = [], 0, 0, 0, []
out_points = 0
for done, (a, targets) in enumerate(wanted.items()):
    bs = sorted(targets)
    results = {}
    if a in stop_node:
        src = stop_node[a]
        need = [b for b in bs if b in stop_node]
        if need:
            straight_d = np.hypot(*(ALL[[stop_node[b] for b in need]] - ALL[src]).T)
            limit = float(straight_d.max()) * 3.5 + 2500
            _, pred = dijkstra(G, directed=True, indices=src, return_predecessors=True, limit=limit)
            fallback = None
            for b in need:
                t = stop_node[b]
                s_d = float(np.hypot(*(ALL[t] - ALL[src])))
                path = walk(pred, src, t) if pred[t] >= 0 or t == src else None
                if path is not None and len(path) >= 2 and length(path) <= max(s_d * 2.4, s_d + 700):
                    results[b] = path
                    continue
                if fallback is None:
                    _, fallback = dijkstra(G2, directed=True, indices=src, return_predecessors=True, limit=limit)
                path = walk(fallback, src, t) if fallback[t] >= 0 else None
                if path is not None and len(path) >= 2 and length(path) <= max(s_d * 2.4, s_d + 700):
                    results[b] = path
                    retried += 1
    for b in bs:
        path = results.get(b)
        if path is None:
            pts = np.array([stop_xy[a], stop_xy[b]])
            straight += 1
        else:
            pts = rdp(ALL[path], 3.0)
            road += 1
            s_d = float(np.hypot(*(ALL[path[-1]] - ALL[path[0]])))
            if s_d > 150:
                ratios.append(length(path) / s_d)
        ints = [(round(lng * 1e5), round(lat * 1e5)) for lng, lat in map(lnglat, pts)]
        flat = [ints[0][0], ints[0][1]]
        for (x0, y0), (x1, y1) in zip(ints, ints[1:]):
            flat += [x1 - x0, y1 - y0]
        out_points += len(ints)
        segs.append([a, b, flat])
    if done % 500 == 0:
        print(done, '/', len(wanted), round(time.time() - started), 's', flush=True)


# 4) 앱과 같은 기준으로 역 묶음(같은 이름, 300m 이내)
def base(n):
    n = re.sub(r'\([^)]*\)|\[[^\]]*\]', '', str(n or '')).replace(' ', '').strip()
    return re.sub(r'^제주국제공항\d+$', '제주국제공항', n)


groups = collections.defaultdict(list)
for i, s in enumerate(stops):
    groups[base(s[1])].append(i)
parent = list(range(len(stops)))


def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


for ids_ in groups.values():
    for i in range(len(ids_)):
        for j in range(i + 1, len(ids_)):
            if np.hypot(*(stop_xy[ids_[i]] - stop_xy[ids_[j]])) <= 300:
                parent[find(ids_[i])] = find(ids_[j])
station = [find(i) for i in range(len(stops))]

ratio = np.array(ratios)
stats = {'pairs': pairs_total, 'road': road, 'oneway_ignored': retried, 'straight': straight, 'points': out_points,
         'detour_median': round(float(np.median(ratio)), 3), 'detour_p99': round(float(np.percentile(ratio, 99)), 3),
         'stops_too_far_from_road': far}
result = {'builtAt': net['builtAt'], 'roadsAt': data.get('osm3s', {}).get('timestamp_osm_base'), 'stats': stats, 'station': station, 'segs': segs}
text = json.dumps(result, separators=(',', ':'))
open(OUT, 'w', encoding='utf-8').write(text)
print(json.dumps(stats), 'bytes', len(text), round(time.time() - started), 's')
