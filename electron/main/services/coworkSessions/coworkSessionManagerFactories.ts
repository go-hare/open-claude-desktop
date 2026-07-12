import { CoworkPermissionBroker } from "./coworkPermissionBroker";
import type { CoworkSessionManagerOptions } from "./coworkSessionManagerTypes";
import type { CoworkSessionRepository } from "./coworkSessionRepository";

export function createCoworkManagerPermissionBroker(
  options: CoworkSessionManagerOptions,
  repository: CoworkSessionRepository,
): CoworkPermissionBroker {
  const brokerOptions = options.permissionBroker;
  return new CoworkPermissionBroker({
    ...brokerOptions,
    emit: options.emit,
    persistAlwaysAllow: (pending, resolution) => {
      brokerOptions?.persistAlwaysAllow?.(pending, resolution);
      const session = repository.get(pending.sessionId);
      if (session) repository.saveIfInitialized(session);
    },
  });
}
