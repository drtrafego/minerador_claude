import "server-only";
import { google, type Auth } from "googleapis";
import { getAuthedClient } from "@/lib/clients/gmail";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

export type TimeSlot = {
  start: string;
  end: string;
};

export type CalendarEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  htmlLink: string;
  meetLink?: string;
};

export class CalendarNotConfiguredError extends Error {
  constructor() {
    super("Google Calendar nao autorizado para esta organizacao. Reconecte o Gmail com permissao de Calendar.");
    this.name = "CalendarNotConfiguredError";
  }
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

function toISO(date: Date): string {
  return date.toISOString();
}

async function getOAuth(organizationId: string): Promise<Auth.OAuth2Client> {
  try {
    const authed = await getAuthedClient(organizationId);
    return authed.oauth as Auth.OAuth2Client;
  } catch {
    throw new CalendarNotConfiguredError();
  }
}

export async function checkCalendarAvailability(
  organizationId: string,
  date: string,
  durationMinutes = 30,
  workdayStart = 8,
  workdayEnd = 18,
): Promise<TimeSlot[]> {
  const oauth = await getOAuth(organizationId);
  const calendar = google.calendar({ version: "v3", auth: oauth });

  const dayStart = new Date(`${date}T${String(workdayStart).padStart(2, "0")}:00:00`);
  const dayEnd = new Date(`${date}T${String(workdayEnd).padStart(2, "0")}:00:00`);

  let busyPeriods: Array<{ start: string; end: string }> = [];
  try {
    const freebusyRes = await calendar.freebusy.query({
      requestBody: {
        timeMin: toISO(dayStart),
        timeMax: toISO(dayEnd),
        items: [{ id: "primary" }],
      },
    });
    busyPeriods = (freebusyRes.data.calendars?.["primary"]?.busy ?? []) as Array<{ start: string; end: string }>;
  } catch {
    throw new CalendarNotConfiguredError();
  }

  const available: TimeSlot[] = [];
  let cursor = new Date(dayStart);

  while (cursor < dayEnd) {
    const slotEnd = addMinutes(cursor, durationMinutes);
    if (slotEnd > dayEnd) break;

    const overlaps = busyPeriods.some((busy) => {
      const bStart = new Date(busy.start);
      const bEnd = new Date(busy.end);
      return cursor < bEnd && slotEnd > bStart;
    });

    if (!overlaps) {
      available.push({
        start: toISO(cursor),
        end: toISO(slotEnd),
      });
    }

    cursor = addMinutes(cursor, durationMinutes);
  }

  return available.slice(0, 6);
}

export async function createCalendarEvent(
  organizationId: string,
  opts: {
    summary: string;
    description?: string;
    startTime: string;
    endTime: string;
    attendeeEmail?: string;
    attendeeName?: string;
    addMeet?: boolean;
  },
): Promise<CalendarEvent> {
  const oauth = await getOAuth(organizationId);
  const calendar = google.calendar({ version: "v3", auth: oauth });

  const attendees = opts.attendeeEmail
    ? [{ email: opts.attendeeEmail, displayName: opts.attendeeName ?? undefined }]
    : [];

  const conferenceData = opts.addMeet !== false
    ? {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      }
    : undefined;

  const res = await calendar.events.insert({
    calendarId: "primary",
    conferenceDataVersion: opts.addMeet !== false ? 1 : 0,
    sendUpdates: attendees.length > 0 ? "all" : "none",
    requestBody: {
      summary: opts.summary,
      description: opts.description,
      start: { dateTime: opts.startTime, timeZone: "America/Sao_Paulo" },
      end: { dateTime: opts.endTime, timeZone: "America/Sao_Paulo" },
      attendees,
      conferenceData,
    },
  });

  const data = res.data;
  if (!data.id) throw new Error("Google Calendar nao retornou id do evento");

  const meetLink =
    data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")
      ?.uri ?? undefined;

  return {
    id: data.id,
    summary: data.summary ?? opts.summary,
    start: data.start?.dateTime ?? opts.startTime,
    end: data.end?.dateTime ?? opts.endTime,
    htmlLink: data.htmlLink ?? "",
    meetLink,
  };
}
