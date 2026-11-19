import test from 'node:test';
import assert from 'node:assert/strict';
import {templateRegistry,publishedTemplates,resolvePublishedTemplate,findTemplate} from '../../src/data/templates.js';
import {validateCatalog,templateDigest} from '../../scripts/templates.js';
import {initialDesign} from '../../src/data/template-design.js';
test('published templates freeze schema-valid documents, source evidence and immutable hashes',()=>{
 validateCatalog(templateRegistry);assert.equal(publishedTemplates().length,8);
 for(const template of publishedTemplates()){assert.deepEqual(initialDesign(template),template.design);assert.ok(Object.isFrozen(template.design));assert.equal(template.digest,templateDigest(template));}
 const edited=structuredClone(templateRegistry);edited.versions[0].design.background='#111111';edited.versions[0].digest=templateDigest(edited.versions[0]);assert.throws(()=>validateCatalog(edited,templateRegistry),/Immutable/);
});
test('publish new revision or withdraw only changes future selection, old snapshots and versions stay readable',()=>{
 const registry=structuredClone(templateRegistry),old=structuredClone(resolvePublishedTemplate('t1',2,undefined,registry).template!);
 const next=structuredClone(old);next.version=3;next.design.background='#123456';next.digest=templateDigest(next);registry.versions.push(next);registry.releases.t1.version=3;
 validateCatalog(registry,templateRegistry);assert.equal(resolvePublishedTemplate('t1',2,old.digest,registry).error,'TEMPLATE_CHANGED');assert.equal(resolvePublishedTemplate('t1',3,next.digest,registry).template?.design.background,'#123456');
 registry.releases.t1.state='withdrawn';assert.equal(resolvePublishedTemplate('t1',3,undefined,registry).error,'TEMPLATE_UNAVAILABLE');assert.ok(!publishedTemplates(registry).some(t=>t.id==='t1'));assert.deepEqual(findTemplate('t1',2,registry),old);assert.notEqual(old.design.background,'#123456');
});
