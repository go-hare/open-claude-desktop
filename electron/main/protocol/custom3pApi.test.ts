import { expect, it } from "vitest";
import { createCustom3pApiHandler } from "./custom3pApi";

it("publishes the persisted install identity through every bootstrap identity field", async () => {
  const installId = "66666666-6666-4666-8666-666666666666";
  const handle = createCustom3pApiHandler({ installId, ionDistRoot: process.cwd() });
  const response = await handle(new Request("app://localhost/api/bootstrap"));
  const payload = (await response?.json()) as {
    account: { tagged_id: string; uuid: string };
    statsig: { user: { userID: string } };
  };

  expect(payload.account).toMatchObject({
    tagged_id: `cowork_3p_${installId}`,
    uuid: installId,
  });
  expect(payload.statsig.user.userID).toBe(installId);
});
