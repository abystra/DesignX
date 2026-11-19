-- Stable keyset orders scoped to one workspace; substring search remains literal.
CREATE INDEX projects_active_page_idx ON projects(workspace_id,updated_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX projects_trash_page_idx ON projects(workspace_id,updated_at DESC,id DESC) WHERE deleted_at IS NOT NULL;
CREATE INDEX projects_recent_page_idx ON projects(workspace_id,last_opened_at DESC,id DESC) WHERE deleted_at IS NULL AND last_opened_at IS NOT NULL;
CREATE INDEX projects_name_page_idx ON projects(workspace_id,title COLLATE "C",id) WHERE deleted_at IS NULL;
CREATE INDEX projects_folder_page_idx ON projects(workspace_id,folder_id,updated_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX assets_page_idx ON assets(workspace_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
