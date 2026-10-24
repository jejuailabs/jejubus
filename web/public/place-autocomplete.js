import {icon} from './icons.js';

export function createPlaceLookup(load,{now=Date.now,ttl=300000,maxEntries=50}={}){
  const cache=new Map(),pending=new Map();
  return async value=>{
    const query=value.trim();if(query.length<2)return [];
    const key=query.toLocaleLowerCase();
    if(cache.get(key)?.until>now())return cache.get(key).places;
    if(pending.has(key))return pending.get(key);
    const request=Promise.resolve().then(()=>load(query)).then(places=>{
      cache.delete(key);if(cache.size>=maxEntries)cache.delete(cache.keys().next().value);
      cache.set(key,{until:now()+ttl,places});return places;
    });
    pending.set(key,request);try{return await request;}finally{pending.delete(key);}
  };
}

function highlight(node,text,query){
  const lower=text.toLocaleLowerCase(),ranges=[];
  for(const word of query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)){
    let start=0,index;while((index=lower.indexOf(word,start))>=0){ranges.push([index,index+word.length]);start=index+word.length;}
  }
  let offset=0;for(const [start,end]of ranges.sort((a,b)=>a[0]-b[0])){
    if(start<offset)continue;node.append(document.createTextNode(text.slice(offset,start)));
    const mark=document.createElement('mark');mark.textContent=text.slice(start,end);node.append(mark);offset=end;
  }node.append(document.createTextNode(text.slice(offset)));
}

export function attachPlaceAutocomplete(input,{target,t,lookup,onSelect,isSelected=()=>false,delay=450}){
  const label=input.closest('label'),host=document.createElement('div');host.className='place-field';label.before(host);host.append(label);
  const panel=document.createElement('div');panel.className='place-suggestions';panel.hidden=true;host.append(panel);
  const list=document.createElement('div');list.id=`${input.id}-suggestions`;list.setAttribute('role','listbox');list.setAttribute('aria-label',t('placeSuggestions',{place:t(target)}));
  const status=document.createElement('div');status.className='suggestion-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');panel.append(list,status);
  input.setAttribute('role','combobox');input.setAttribute('aria-label',t(target));input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');input.setAttribute('enterkeyhint','search');
  let timer,version=0,alive=true,composing=false,items=[],active=-1;
  function close(){clearTimeout(timer);version++;panel.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
  function open(){panel.hidden=false;input.setAttribute('aria-expanded','true');}
  function activate(index){active=index;[...list.children].forEach((node,i)=>node.setAttribute('aria-selected',String(i===active)));if(active>=0){input.setAttribute('aria-activedescendant',list.children[active].id);list.children[active].scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');}
  function choose(index){const place=items[index];if(!place)return;close();onSelect(place);}
  async function run(query,request){
    if(!alive||request!==version||document.activeElement!==input)return;
    items=[];active=-1;list.replaceChildren();input.removeAttribute('aria-activedescendant');status.textContent=t('loading');open();
    try{
      const result=await lookup(query);
      if(!alive||request!==version||input.value.trim()!==query||document.activeElement!==input)return;
      items=result.slice(0,7);list.replaceChildren();
      items.forEach((place,index)=>{
        const option=document.createElement('div');option.className='place-suggestion';option.id=`${list.id}-${index}`;option.setAttribute('role','option');option.setAttribute('aria-selected','false');
        const pin=document.createElement('span');pin.className='suggestion-pin';pin.innerHTML=icon('pin');
        const text=document.createElement('span'),name=document.createElement('strong'),address=document.createElement('small');highlight(name,place.name,query);highlight(address,place.address||'',query);text.append(name,address);option.append(pin,text);
        option.addEventListener('pointerdown',event=>event.preventDefault());option.addEventListener('pointermove',()=>{if(active!==index)activate(index);});option.addEventListener('click',()=>choose(index));list.append(option);
      });
      status.textContent=items.length?t('suggestionCount',{n:items.length}):t('noResults');
    }catch(error){if(alive&&request===version){list.replaceChildren();status.textContent=t(error.key||'connectionError');}}
  }
  function schedule(immediate=false){
    close();const query=input.value.trim();if(composing||query.length<2||query.length>100||/^\d+(?:\.\d+)?\s*,/.test(query))return;
    const request=version;timer=setTimeout(()=>run(query,request),immediate?0:delay);
  }
  function keydown(event){
    if(composing||event.isComposing||event.keyCode===229)return;
    if(event.key==='Escape'){close();return;}
    if(event.key==='Tab'){close();return;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();if(panel.hidden){schedule(true);return;}if(items.length)activate(active<0?(event.key==='ArrowDown'?0:items.length-1):(active+(event.key==='ArrowDown'?1:-1)+items.length)%items.length);
    }else if(event.key==='Enter'&&!panel.hidden&&items.length){event.preventDefault();choose(active<0?0:active);}
  }
  const focus=()=>{if(!isSelected())schedule();},inputEvent=event=>{if(!event.isComposing)schedule();},compositionStart=()=>{composing=true;close();},compositionEnd=()=>{composing=false;schedule();};
  const outside=event=>{if(!host.contains(event.target))close();},blur=()=>{setTimeout(()=>{if(alive&&!host.contains(document.activeElement))close();},0);};
  const listeners={focus,input:inputEvent,keydown,compositionstart:compositionStart,compositionend:compositionEnd,blur};
  for(const [name,handler]of Object.entries(listeners))input.addEventListener(name,handler);
  document.addEventListener('pointerdown',outside);
  return ()=>{alive=false;close();document.removeEventListener('pointerdown',outside);for(const [name,handler]of Object.entries(listeners))input.removeEventListener(name,handler);};
}
