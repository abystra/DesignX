import {resolvePublishedTemplate} from '../../../src/data/templates.js';
import {HttpError} from './common.js';
/** Clients send the previewed revision; legacy ID-only callers resolve once and still freeze it. */
export function resolveTemplate(input:any) {
 if(input.templateId===undefined)return null;
 if(typeof input.templateId!=='string'||input.templateId.length>100||
   (input.templateVersion!==undefined&&(!Number.isSafeInteger(input.templateVersion)||input.templateVersion<1)))
  throw new HttpError(400,'INVALID_TEMPLATE','模板版本无效');
 const result=resolvePublishedTemplate(input.templateId,input.templateVersion,input.templateDigest);
 if(result.error)throw new HttpError(409,result.error,result.error==='TEMPLATE_CHANGED'?'模板已更新，请刷新模板列表后重新预览':'模板已下架或不可用，请重新选择');
 return result.template!;
}
export function templateOrigin(template:any) {
 return {kind:'template',templateId:template.id,version:template.version,digest:template.digest,title:template.title,source:template.source};
}
