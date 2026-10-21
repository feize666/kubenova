DO $$
DECLARE
  active_count INTEGER;
  slotted_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO active_count
  FROM "KubernetesUpdateTask"
  WHERE "status" IN ('queued', 'running');

  SELECT COUNT(*) INTO slotted_count
  FROM "KubernetesUpdateTask"
  WHERE "activeSlot" = 'system-update';

  IF active_count > 1 THEN
    RAISE EXCEPTION 'Kubernetes update queue contains % active tasks; resolve queued/running tasks before applying single-task serialization', active_count;
  END IF;

  IF active_count <> slotted_count THEN
    RAISE EXCEPTION 'Kubernetes update active task and serialization slot are inconsistent';
  END IF;
END $$;
