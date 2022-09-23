import { Assignment } from "../config/config";
import { fromISO as newTime, addDays, Time, format as formatTime } from "./time";
import * as sheet from "./sheet";
import * as form from "./form";
import config from "../config/config";
import literal from "../config/literalTypes";

type UpdateSummary = {
  remainingDays: number,
  comments?: string[],
  usage: Array<{
    assignment: Assignment,
    free: number,
    totalUsed: number,
  }>,
};

type Response = {
  assignment : Assignment,
  success: boolean,
  review?: boolean,
  state: Partial<Record<"old" | "new", {deadline: Time, used: number}>>,
  updateSummary?: UpdateSummary,
  freeDays?: string[],
  comments?: string[],
};

// TODO: integrate with the rest
function updateAndRespond(entry: sheet.Entry, request: form.Request): Response {
  const assignment = request.assignment;
  const deadline = newTime(config.assignments[assignment].deadline);

  const remaining =
    config.policy.maxLateDays -
    Object.values(entry.days)
      .map((days) => days.used)
      .reduce((a, b) => a + b, 0);

  const used = entry.days[assignment].used;
  const free = entry.days[assignment].free;
  const resp: Response = {
    assignment: assignment,
    success: true,
    state: {
      "old": {deadline: deadline, used: used},
    }
  };

  switch (request.action.act) {
    case "summary":
      resp.comments = literal.summary.body({});
      break;

    case "refund": {
      // refund
      const newDeadlineWithoutFreeDays = addDays(
        deadline,
        Math.max(0, used - request.action.days)
      );

      switch (true) {
        case request.time > addDays(deadline, config.policy.refundPeriodInDays):
          resp.success= false;
          resp.comments= literal.refund.beyond.body({
            assignment: assignment,
            oldDeadline: formatTime(addDays(deadline, config.policy.refundPeriodInDays))
          })
          break;

        case used === 0:
          resp.success= false;
          resp.comments= literal.refund.unused.body({assignment: assignment, oldDeadline: formatTime(deadline)});
          break;

        case request.time > newDeadlineWithoutFreeDays:
          resp.review= true;
          resp.comments= literal.refund.received.body({numOfDays: request.action.days});
          break;

        default: {
          entry.days[assignment].used = Math.max(0, used - request.action.days);
          const newDeadline = addDays(
            deadline,
            Math.max(0, used - request.action.days) + free
          );
          resp.state.new = {
            deadline: newDeadline,
            used: entry.days[assignment].used
          };
          resp.comments= literal.refund.approved.body({
            assignment: assignment,
            numOfDays: Math.min(used,request.action.days),
            oldDeadline: formatTime(deadline),
            newDeadline: formatTime(newDeadline),
            freeDayMsg: [],   // TODO
          });
        }
      }
      break;
    }

    case "request": {
      switch (true) {
        case request.time >
          addDays(deadline, config.policy.requestPeriodInDays):
          resp.success= false;
          resp.comments= literal.request.beyond.body({
            assignment: assignment,
            oldDeadline: formatTime(addDays(deadline, config.policy.requestPeriodInDays)),
          });
          break;

        case request.action.days < used:
          resp.success= false;
          resp.comments= literal.request.unused.body({numOfDays: used});
          break;

        case request.action.days - used > remaining:
          resp.success= false;
          resp.comments= literal.request.global.body({
            assignment: assignment, 
            numOfDays: request.action.days,
            leftDays: remaining
          });
          break;

        default: {
          entry.days[assignment].used = request.action.days;
          const newDeadline = addDays(deadline, request.action.days + free);
          resp.state.new = {
            deadline: newDeadline,
            used: entry.days[assignment].used
          };
          resp.comments = literal.request.approved.body({
            assignment: assignment,
            numOfDays: request.action.days,
            oldDeadline: formatTime(deadline),
            newDeadline: formatTime(newDeadline),
            freeDayMsg: [],
          });
          break;
        }
      }
    }

    default: {}
  }
 // add summary
  return resp;
}
