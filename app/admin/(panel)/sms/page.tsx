import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getSettings, envFallback } from "@/lib/settings";
import { smsCfg, SMS_TEMPLATES } from "@/lib/sms";
import SmsComposer from "./client";

export const dynamic = "force-dynamic";
export const metadata = { title: "SMS" };

/* SMS screen.
   A BD shop's customers read SMS, not email — "parcel ta aj pathano hoyeche" gets answered,
   an email often does not. This is the same gateway that the site dials (BulkSMSBD by default),
   with the parcel-update texts pre-written so nobody has to compose Bangla SMS by hand at 11pm. */
export default async function SmsPage({ searchParams }: { searchParams: { t?: string } }) {
  const user = await requireAdmin(searchParams);
  const s = envFallback(await getSettings());
  const cfg = smsCfg(s);
  const configured = !!(cfg.enabled !== false && cfg.apiKey);
  const logs = await db.appLog.findMany({ where: { kind: "SMS" }, orderBy: { id: "desc" }, take: 60 });
  const sent = logs.filter((l) => l.level === "INFO").length;
  const failed = logs.filter((l) => l.level !== "INFO").length;
  const auto = {
    CONFIRMED: (s as any).notifications?.sms_on_confirmed === true,
    PACKED: (s as any).notifications?.sms_on_packed === true,
    SHIPPED: (s as any).notifications?.sms_on_shipped === true,
    DELIVERED: (s as any).notifications?.sms_on_delivered === true,
    CANCELLED: (s as any).notifications?.sms_on_cancelled === true,
  };

  return (
    <>
      <div className="admin-top">
        <div><h1>SMS</h1><div className="who">{configured ? `${cfg.provider || "bulksmsbd"} · sender ${cfg.senderId || "—"}` : "gateway not configured"} · {user.name}</div></div>
        <a className="abtn" href="/admin/settings">SMS settings</a>
      </div>

      {!configured && (
        <div className="noti err" style={{ marginBottom: 16 }}>
          No SMS gateway key yet — messages will be <b>logged but not sent</b>. Settings → Notifications → SMS
          Gateway-e provider, API key ar sender id bosan (BulkSMSBD / GreenWeb / MimSMS, or paste a custom GET URL).
        </div>
      )}

      <div className="kpis kpis-4" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="kpi"><div className="k-label">Gateway</div><div className="k-val">{configured ? "Connected" : "Off"}</div><div className="k-sub">{cfg.provider || "bulksmsbd"} · {cfg.senderId || "no sender id"}</div></div>
        <div className="kpi"><div className="k-label">Sent (recent log)</div><div className="k-val">{sent}</div><div className="k-sub">last {logs.length} SMS events</div></div>
        <div className="kpi"><div className="k-label">Failed / refused</div><div className="k-val">{failed}</div><div className="k-sub">{failed ? "check the log below" : "nothing failed"}</div></div>
        <div className="kpi"><div className="k-label">Auto sends on</div><div className="k-val">{Object.values(auto).filter(Boolean).length} of 5</div><div className="k-sub">status change hole automatic SMS</div></div>
      </div>

      <div className="adm-cols" style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 16, alignItems: "start"  }}>
        <div className="acard">
          <div className="acard-h"><h3>Send an SMS</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>order code dile naam/amount auto boshe</span></div>
          <div className="acard-b">
            <SmsComposer templates={SMS_TEMPLATES.map((t) => ({ id: t.id, label: t.label, body: t.body }))} configured={configured} />
          </div>
        </div>

        <div className="acard">
          <div className="acard-h"><h3>SMS log</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>gateway reply soho</span></div>
          <div className="acard-b" style={{ maxHeight: 460, overflow: "auto", fontSize: 12.5 }}>
            {logs.length === 0 ? <div style={{ color: "var(--muted)" }}>No SMS activity yet.</div> : logs.map((l) => (
              <div key={l.id} style={{ padding: "7px 0", borderBottom: "1px solid var(--line)" }}>
                <span className={"pill " + (l.level === "INFO" ? "DELIVERED" : l.level === "WARN" ? "PROCESSING" : "CANCELLED")}>{l.level}</span>{" "}
                <span style={{ color: "var(--muted)" }}>{l.createdAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                <div style={{ marginTop: 2 }}>{l.message}</div>
                {l.meta && <details style={{ color: "var(--muted)" }}><summary>gateway reply</summary><code style={{ fontSize: 11.5, wordBreak: "break-all" }}>{l.meta}</code></details>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="cfg-note" style={{ marginTop: 16 }}>
        Auto-SMS switches live in Settings → Notifications (per status). A message costs one gateway credit and is
        cut into 160-character parts, so the templates above are kept short on purpose.
      </div>
    </>
  );
}
