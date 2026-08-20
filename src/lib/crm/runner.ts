import "server-only";
import { getStore } from "../db";
import { renderTemplate } from "./merge";
import {
  dailySendCap,
  sendEmail,
  sendSms,
  withinSendingHours,
} from "../outreach/providers";
import type { SequenceEnrollment, SequenceWithSteps } from "./types";
import type { Lead } from "../types";

export interface RunnerResult {
  ranAt: string;
  /** Enrollments that were due and processed. */
  processed: number;
  tasksCreated: number;
  emailsSent: number;
  smsSent: number;
  /** Enrollments stopped by a guardrail (DNC, closed, missing contact). */
  stopped: number;
  completed: number;
  /** Deferred because it's outside sending hours or the cap was hit. */
  deferred: number;
  errors: string[];
  /** Human-readable log of what happened, newest last. */
  log: string[];
}

/** A lead in a closed state should never keep receiving a cadence. */
function isClosed(lead: Lead): boolean {
  return ["won", "lost", "ignored"].includes(lead.status);
}

/**
 * Advance every sequence enrollment whose next step is due.
 *
 * For each due step:
 *  - guardrails first (do-not-contact, closed lead, missing contact details)
 *  - `call`/`manual` steps become tasks
 *  - `email`/`sms` steps send when a provider is configured, otherwise become
 *    tasks with the message already written — nothing is silently dropped
 *  - the enrollment advances to the next step, or completes
 *
 * Safe to run repeatedly; it only acts on enrollments that are actually due.
 */
export async function runSequences(now = new Date()): Promise<RunnerResult> {
  const store = await getStore();
  const result: RunnerResult = {
    ranAt: now.toISOString(),
    processed: 0,
    tasksCreated: 0,
    emailsSent: 0,
    smsSent: 0,
    stopped: 0,
    completed: 0,
    deferred: 0,
    errors: [],
    log: [],
  };

  const due = await store.dueEnrollments(now.toISOString());
  if (!due.length) {
    result.log.push("No sequence steps were due.");
    return result;
  }

  const sequences = await store.listSequences();
  const byId = new Map<string, SequenceWithSteps>(sequences.map((s) => [s.id, s]));
  const canSendNow = withinSendingHours(now);
  const cap = dailySendCap();
  let sent = 0;

  for (const enrollment of due) {
    const sequence = byId.get(enrollment.sequenceId);
    const lead = await store.getLead(enrollment.leadId);

    // ---- guardrails -------------------------------------------------------
    if (!sequence || !sequence.active) {
      await stop(enrollment, "the sequence is inactive");
      continue;
    }
    if (!lead) {
      await store.updateEnrollment(enrollment.id, { status: "stopped" });
      result.stopped += 1;
      continue;
    }
    if (lead.doNotContact) {
      await stop(enrollment, `${lead.name} is marked do-not-contact`);
      continue;
    }
    if (isClosed(lead)) {
      await stop(enrollment, `${lead.name} is ${lead.status}`);
      continue;
    }

    const step = sequence.steps[enrollment.currentStep];
    if (!step) {
      await store.updateEnrollment(enrollment.id, {
        status: "completed",
        completedAt: now.toISOString(),
        nextDueAt: null,
      });
      result.completed += 1;
      result.log.push(`${lead.name}: finished “${sequence.name}”.`);
      continue;
    }

    result.processed += 1;
    const subject = renderTemplate(step.subject, lead);
    const body = renderTemplate(step.body, lead);

    // ---- act on the step --------------------------------------------------
    let handled = false;

    if (step.channel === "email" || step.channel === "sms") {
      const target = step.channel === "email" ? lead.email : lead.phone;

      if (!target) {
        // No address to send to — make it a task so a human can find one.
        await store.createTask({
          leadId: lead.id,
          title: `${step.channel === "email" ? "Find an email for" : "Find a number for"} ${lead.name}`,
          notes: `Sequence “${sequence.name}” step ${enrollment.currentStep + 1} couldn't run — no ${step.channel} on file.\n\nMessage ready to send:\n\n${subject}\n\n${body}`,
          type: "research",
          dueAt: now.toISOString(),
          enrollmentId: enrollment.id,
        });
        result.tasksCreated += 1;
        result.log.push(`${lead.name}: no ${step.channel} on file — created a research task.`);
        handled = true;
      } else if (!canSendNow || sent >= cap) {
        // Defer without advancing, so it retries on the next run.
        result.deferred += 1;
        result.log.push(
          `${lead.name}: deferred — ${!canSendNow ? "outside sending hours" : `daily cap of ${cap} reached`}.`,
        );
        continue;
      } else {
        const send =
          step.channel === "email"
            ? await sendEmail(target, subject, body, process.env.OUTREACH_REPLY_TO?.trim())
            : await sendSms(target, body);

        if (send.ok) {
          sent += 1;
          if (step.channel === "email") result.emailsSent += 1;
          else result.smsSent += 1;
          await store.logActivity({
            leadId: lead.id,
            type: step.channel,
            body: step.channel === "email" ? `${subject}\n\n${body}` : body,
            outcome: null,
            meta: { sequenceId: sequence.id, step: enrollment.currentStep, auto: true, messageId: send.id },
            actor: "sequence",
            durationMinutes: null,
          });
          result.log.push(`${lead.name}: sent ${step.channel} — “${subject}”.`);
          handled = true;
        } else if (send.notConfigured) {
          // Expected path when no provider is set up: hand it to the user.
          await store.createTask({
            leadId: lead.id,
            title: `Send ${step.channel}: ${subject}`,
            notes: `${body}\n\n— from sequence “${sequence.name}”, step ${enrollment.currentStep + 1}`,
            type: step.channel,
            dueAt: now.toISOString(),
            enrollmentId: enrollment.id,
          });
          result.tasksCreated += 1;
          result.log.push(`${lead.name}: ${step.channel} step became a task (no sender configured).`);
          handled = true;
        } else {
          result.errors.push(`${lead.name}: ${step.channel} failed — ${send.error}`);
          // A genuine send failure defers rather than skipping the touch.
          result.deferred += 1;
          continue;
        }
      }
    } else {
      // call / manual steps are always tasks.
      await store.createTask({
        leadId: lead.id,
        title: subject || `Follow up with ${lead.name}`,
        notes: body,
        type: step.channel === "call" ? "call" : "followup",
        dueAt: now.toISOString(),
        enrollmentId: enrollment.id,
      });
      result.tasksCreated += 1;
      result.log.push(`${lead.name}: created ${step.channel} task — “${subject}”.`);
      handled = true;
    }

    if (!handled) continue;

    // ---- advance ----------------------------------------------------------
    const nextIndex = enrollment.currentStep + 1;
    const nextStep = sequence.steps[nextIndex];

    if (!nextStep) {
      await store.updateEnrollment(enrollment.id, {
        status: "completed",
        completedAt: now.toISOString(),
        currentStep: nextIndex,
        nextDueAt: null,
      });
      result.completed += 1;
    } else {
      // Day offsets are measured from enrolment, not from the previous step,
      // so a delayed run can't stretch the whole cadence out.
      const nextDue = new Date(
        Date.parse(enrollment.startedAt) + nextStep.dayOffset * 86_400_000,
      );
      await store.updateEnrollment(enrollment.id, {
        currentStep: nextIndex,
        nextDueAt: nextDue.toISOString(),
      });
    }
  }

  async function stop(enrollment: SequenceEnrollment, reason: string): Promise<void> {
    await store.updateEnrollment(enrollment.id, {
      status: "stopped",
      nextDueAt: null,
      completedAt: now.toISOString(),
    });
    result.stopped += 1;
    result.log.push(`Stopped: ${reason}.`);
  }

  return result;
}
