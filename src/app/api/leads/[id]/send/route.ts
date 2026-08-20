import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { renderTemplate } from "@/lib/crm/merge";
import { sendEmail, sendSms, withinSendingHours } from "@/lib/outreach/providers";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * Send a one-off email or text to a lead, rendering merge fields first and
 * logging the result to the timeline.
 */
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const channel = body.channel === "sms" ? "sms" : "email";
  const rawSubject = typeof body.subject === "string" ? body.subject : "";
  const rawBody = typeof body.body === "string" ? body.body : "";
  if (!rawBody.trim()) {
    return NextResponse.json({ error: "A message body is required" }, { status: 400 });
  }

  try {
    const store = await getStore();
    const lead = await store.getLead(id);
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    if (lead.doNotContact) {
      return NextResponse.json(
        { error: "This lead is marked do-not-contact." },
        { status: 409 },
      );
    }

    const target = channel === "email" ? lead.email : lead.phone;
    if (!target) {
      return NextResponse.json(
        { error: `No ${channel === "email" ? "email address" : "phone number"} on file for this lead.` },
        { status: 409 },
      );
    }

    if (!withinSendingHours()) {
      return NextResponse.json(
        { error: "Outside sending hours (Mon–Sat, 8am–7pm). Schedule it as a task instead." },
        { status: 409 },
      );
    }

    const subject = renderTemplate(rawSubject, lead);
    const message = renderTemplate(rawBody, lead);

    const result =
      channel === "email"
        ? await sendEmail(target, subject, message, process.env.OUTREACH_REPLY_TO?.trim())
        : await sendSms(target, message);

    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Send failed" }, { status: 502 });
    }

    await store.logActivity({
      leadId: id,
      type: channel,
      body: channel === "email" ? `${subject}\n\n${message}` : message,
      outcome: null,
      meta: { manual: true, messageId: result.id },
      actor: "me",
      durationMinutes: null,
    });

    return NextResponse.json({ ok: true, id: result.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
