-- Product facts contain identifiers and fixed enums only, never documents or credentials.
CREATE TABLE feedback (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 category text NOT NULL CHECK(category IN ('problem','suggestion')),
 subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 100),
 message text NOT NULL CHECK(length(message) BETWEEN 1 AND 2000),
 project_id text REFERENCES projects(id) ON DELETE SET NULL, job_id text REFERENCES jobs(id) ON DELETE SET NULL,
 status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','triaged','resolved','closed')),
 revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,workspace_id)
);
CREATE INDEX feedback_workspace_idx ON feedback(workspace_id,created_at DESC,id DESC);
CREATE TABLE feedback_updates (
 id bigserial PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 feedback_id text NOT NULL, revision integer NOT NULL,
 status text NOT NULL CHECK(status IN ('received','triaged','resolved','closed')),
 reply text NOT NULL CHECK(length(reply) BETWEEN 1 AND 2000), actor text NOT NULL CHECK(length(actor) BETWEEN 1 AND 80),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(feedback_id,revision),
 FOREIGN KEY(feedback_id,workspace_id) REFERENCES feedback(id,workspace_id) ON DELETE CASCADE
);
CREATE TABLE product_metrics_settings (
 workspace_id text PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
 excluded boolean NOT NULL DEFAULT false, reason text NOT NULL DEFAULT '',
 tracking_started_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO product_metrics_settings(workspace_id) SELECT id FROM workspaces;
CREATE TABLE product_milestones (
 workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('registration_completed','first_effective_edit','project_opened','download_requested')),
 subject_id text NOT NULL, project_id text REFERENCES projects(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,kind,subject_id)
);
CREATE TABLE product_events (
 id bigserial PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 event text NOT NULL CHECK(event IN ('registration_completed','project_created','first_effective_edit','save_succeeded','export_completed','download_requested','project_opened','project_reopened')),
 subject_id text NOT NULL, dedupe_key text NOT NULL CHECK(length(dedupe_key) BETWEEN 1 AND 200),
 project_id text REFERENCES projects(id) ON DELETE CASCADE, document_id text, revision integer,
 format text CHECK(format IN ('png','jpeg','jpg','webp','pdf','svg','dxproj')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,event,subject_id,dedupe_key)
);
CREATE INDEX product_events_workspace_time_idx ON product_events(workspace_id,created_at);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['feedback','feedback_updates','product_metrics_settings','product_milestones','product_events'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY workspace_isolation ON %I USING (workspace_id=current_setting(''app.workspace_id'',true)) WITH CHECK (workspace_id=current_setting(''app.workspace_id'',true))',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO designx_tenant',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON SEQUENCE feedback_updates_id_seq,product_events_id_seq TO designx_tenant;
CREATE FUNCTION record_product_document_fact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE first_edit text;
BEGIN
 INSERT INTO product_events(workspace_id,event,subject_id,dedupe_key,project_id,document_id,revision)
 VALUES(NEW.workspace_id,'save_succeeded',NEW.id,NEW.revision::text,NEW.project_id,NEW.id,NEW.revision) ON CONFLICT DO NOTHING;
 IF NEW.content IS DISTINCT FROM OLD.content THEN
  INSERT INTO product_milestones(workspace_id,kind,subject_id,project_id)
  VALUES(NEW.workspace_id,'first_effective_edit',NEW.project_id,NEW.project_id)
  ON CONFLICT DO NOTHING RETURNING subject_id INTO first_edit;
  IF first_edit IS NOT NULL THEN
   INSERT INTO product_events(workspace_id,event,subject_id,dedupe_key,project_id,document_id,revision)
   VALUES(NEW.workspace_id,'first_effective_edit',NEW.project_id,'first',NEW.project_id,NEW.id,NEW.revision) ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER product_document_fact AFTER UPDATE ON documents FOR EACH ROW
 WHEN(NEW.kind='artboard' AND NEW.revision<>OLD.revision) EXECUTE FUNCTION record_product_document_fact();
CREATE FUNCTION record_product_creation_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO product_events(workspace_id,event,subject_id,dedupe_key,project_id)
 VALUES(NEW.workspace_id,'project_created',NEW.id,'created',NEW.id) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER product_creation_fact AFTER INSERT ON projects FOR EACH ROW EXECUTE FUNCTION record_product_creation_fact();
CREATE FUNCTION record_product_export_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO product_events(workspace_id,event,subject_id,dedupe_key,project_id,document_id,revision,format)
 VALUES(NEW.workspace_id,'export_completed',NEW.id,'completed',NEW.project_id,NEW.payload->>'documentId',(NEW.payload->>'revision')::integer,NEW.payload->>'format') ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER product_export_fact AFTER UPDATE ON jobs FOR EACH ROW
 WHEN(NEW.kind='render.export' AND NEW.status='succeeded' AND OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION record_product_export_fact();
