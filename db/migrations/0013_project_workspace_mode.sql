-- Existing multi-artboard projects retain their Studio entry point.
ALTER TABLE projects ADD COLUMN workspace_mode text NOT NULL DEFAULT 'studio'
  CHECK (workspace_mode IN ('editor', 'studio'));

ALTER TABLE projects ADD COLUMN creation_note text NOT NULL DEFAULT '';
