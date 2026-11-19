import {useRef} from 'react';
import {api} from './api';
export type PreferenceSnapshot<T=any>={value:T;revision:number};
export const readPreference=(key:string)=>api<PreferenceSnapshot>(`/preferences/${key}?meta=1`);
/** Retries of the same mounted form/action keep their request key after an unknown response. */
export function createPreferenceWriter(){
 const pending=new Map<string,string>();
 return async(key:string,body:any,revision?:number):Promise<PreferenceSnapshot>=>{
  const signature=JSON.stringify([key,body,revision]);
  let requestKey=pending.get(signature);
  if(!requestKey){requestKey=crypto.randomUUID();pending.set(signature,requestKey);}
  try{
   const result=await api<PreferenceSnapshot>(`/preferences/${key}${revision===undefined?'/items':'?meta=1'}`,{method:revision===undefined?'PATCH':'PUT',body,headers:{'Idempotency-Key':requestKey,...(revision===undefined?{}:{'If-Match':`"${revision}"`})}});
   pending.delete(signature);return result;
  }catch(error:any){if(error.status>=400&&error.status<500&&![408,429].includes(error.status))pending.delete(signature);throw error;}
 };
}
export function usePreferenceWriter(){const writer=useRef<ReturnType<typeof createPreferenceWriter>|null>(null);if(!writer.current)writer.current=createPreferenceWriter();return writer.current;}
export function acceptPreference(snapshot:PreferenceSnapshot,revision:{current:number},setValue:(value:any)=>void){
 if(snapshot.revision>=revision.current){revision.current=snapshot.revision;setValue(snapshot.value||[]);}
}
/** Explicitly retain edited fields while taking remote changes to untouched fields. */
export function mergePreferenceFields(base:Record<string,any>,draft:Record<string,any>,remote:Record<string,any>){
 const result={...remote};for(const key of new Set([...Object.keys(base),...Object.keys(draft)]))if(JSON.stringify(base[key])!==JSON.stringify(draft[key]))result[key]=draft[key];return result;
}
