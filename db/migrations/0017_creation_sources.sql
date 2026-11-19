-- Existing works stay unknown: titles and old type strings are not provenance.
ALTER TABLE projects ADD COLUMN creation_source jsonb NOT NULL DEFAULT '{"kind":"unknown"}';
ALTER TABLE documents ADD COLUMN creation_source jsonb NOT NULL DEFAULT '{"kind":"unknown"}';
ALTER TABLE projects ADD COLUMN ai_source jsonb;
-- Backfill only durable evidence of an applied AI result, never a queued request/title.
-- Migrations run as the owner; enumerate tenants explicitly under FORCE RLS.
DO $$ DECLARE w record; BEGIN
 FOR w IN SELECT id FROM workspaces LOOP
  PERFORM set_config('app.workspace_id',w.id,true);
  UPDATE projects p SET ai_source=jsonb_build_object('kind','agent','turnId',a.id)
   FROM ai_turns a WHERE p.id=a.project_id AND p.workspace_id=w.id
   AND a.stage='completed' AND (jsonb_array_length(a.artboard_ids)>0 OR a.applied_revision IS NOT NULL);
  UPDATE projects p SET ai_source=jsonb_build_object('kind','image','generationId',r.id)
   FROM creative_requests r JOIN generation_outputs o ON o.request_id=r.id
   WHERE p.id=r.project_id AND p.workspace_id=w.id AND p.ai_source IS NULL
   AND o.state='ready' AND o.placement_status='board' AND o.asset_version_id IS NOT NULL;
 END LOOP;
END $$;
CREATE INDEX projects_ai_source_idx ON projects(workspace_id,updated_at DESC,id DESC) WHERE deleted_at IS NULL AND ai_source IS NOT NULL;
