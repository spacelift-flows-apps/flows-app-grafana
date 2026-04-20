import { alertRuleBlock } from "./alertRule";
import { contactPointBlock } from "./contactPoint";

export const alertsBlocks = {
  alertRule: alertRuleBlock,
  contactPoint: contactPointBlock,
} as const;

export { alertRuleBlock, contactPointBlock };
