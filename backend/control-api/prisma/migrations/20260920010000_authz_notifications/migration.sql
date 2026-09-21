-- Transactional wake-ups only. Listeners must reauthorize, and fail closed on disconnect.
CREATE FUNCTION notify_kubenova_authorization() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE affected_user text;
BEGIN
  IF TG_TABLE_NAME = 'User' THEN
    affected_user := NEW.id;
  ELSE
    affected_user := NEW."affectedUserId";
  END IF;
  PERFORM pg_notify('kubenova_authorization', json_build_object(
    'schema', TG_TABLE_SCHEMA,
    'userId', affected_user
  )::text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER kubenova_user_authorization_changed
AFTER UPDATE OF "authzVersion", "isActive" ON "User"
FOR EACH ROW WHEN (OLD."authzVersion" IS DISTINCT FROM NEW."authzVersion" OR OLD."isActive" IS DISTINCT FROM NEW."isActive")
EXECUTE FUNCTION notify_kubenova_authorization();

CREATE TRIGGER kubenova_grant_authorization_changed
AFTER INSERT ON "AuthorizationChange"
FOR EACH ROW EXECUTE FUNCTION notify_kubenova_authorization();
