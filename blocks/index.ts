import { alertsBlocks } from "./alerts";
import { exploreBlocks } from "./explore";
import { requestsBlocks } from "./requests";

export const blocks = {
  ...alertsBlocks,
  ...exploreBlocks,
  ...requestsBlocks,
} as const;
