-- Derived previews use the existing tenant-isolated jobs/storage candidate lifecycle.
CREATE INDEX jobs_preview_lookup_idx ON jobs(workspace_id,project_id,(payload->>'previewKey'),created_at DESC) WHERE kind='render.thumbnail';
