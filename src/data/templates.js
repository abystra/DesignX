import registry from './template-registry.json' with {type:'json'};
function freeze(value) { if(value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
export const templateRegistry = freeze(registry);
export function publishedTemplates(catalog=registry) {
  return Object.entries(catalog.releases).flatMap(([id,release]) => release.state==='published'
    ? catalog.versions.filter(item=>item.id===id&&item.version===release.version) : []);
}
export function findTemplate(id,version,catalog=registry) {
  return catalog.versions.find(item=>item.id===id&&item.version===version);
}
export function resolvePublishedTemplate(id,version,digest,catalog=registry) {
  const release=catalog.releases[id];
  if(!release||release.state!=='published')return {error:'TEMPLATE_UNAVAILABLE'};
  const current=findTemplate(id,release.version,catalog);
  if(!current)return {error:'TEMPLATE_UNAVAILABLE'};
  if((version!==undefined&&version!==current.version)||(digest!==undefined&&digest!==current.digest))return {error:'TEMPLATE_CHANGED'};
  return {template:current};
}
export const templates = publishedTemplates();
// Archived versions remain available for saved works after withdrawal.
const bundledImages=new Map(templateRegistry.versions.flatMap(t=>t.source.images.flatMap(image=>[[image.file,image],...(image.legacyFile?[[image.legacyFile,image]]:[])])));
export const builtinImageSource=src=>bundledImages.get(src);
