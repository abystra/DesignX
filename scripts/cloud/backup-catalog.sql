BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH objects AS (
 SELECT bucket,object_key AS key,sha256,bytes FROM asset_versions
 UNION ALL SELECT bucket,thumbnail_key,NULL,NULL FROM asset_versions WHERE thumbnail_key IS NOT NULL
 UNION ALL SELECT coalesce(storage_bucket,:'default_bucket'),object_key,NULL,bytes FROM assets WHERE status='ready'
 UNION ALL SELECT coalesce(storage_bucket,:'default_bucket'),thumbnail_key,NULL,NULL FROM assets WHERE status='ready' AND thumbnail_key IS NOT NULL
 UNION ALL SELECT old_bucket,old_object_key,NULL,NULL FROM storage_migrations
 UNION ALL SELECT old_bucket,old_thumbnail_key,NULL,NULL FROM storage_migrations WHERE old_thumbnail_key IS NOT NULL
), unique_objects AS (
 SELECT bucket,key,max(sha256) AS sha256,max(bytes) AS bytes FROM objects GROUP BY bucket,key
)
SELECT json_build_object(
 'version',1,'snapshot',pg_export_snapshot(),'database',current_database(),'createdAt',now(),
 'counts',json_build_object('users',(SELECT count(*) FROM users),'workspaces',(SELECT count(*) FROM workspaces),'projects',(SELECT count(*) FROM projects),'documents',(SELECT count(*) FROM documents),'versions',(SELECT count(*) FROM document_versions),'assetVersions',(SELECT count(*) FROM asset_versions)),
 'objects',coalesce((SELECT json_agg(unique_objects ORDER BY bucket,key) FROM unique_objects),'[]'::json)
)::jsonb;
-- The orchestrator keeps this transaction open until pg_dump --snapshot exits.
