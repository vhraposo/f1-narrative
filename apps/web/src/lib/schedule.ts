import { get, patch, post, remove } from "./api";

export type Schedule = {
  id: string;
  characterId: string;
  activity: string;
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
};

export type CreateScheduleInput = {
  activity: string;
  startsAt: string;
  endsAt?: string | null;
};

export type UpdateScheduleInput = Partial<CreateScheduleInput>;

export function formatScheduleTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatScheduleDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.toLocaleDateString("pt-BR", { day: "2-digit" });
  const month = date
    .toLocaleDateString("pt-BR", { month: "short" })
    .replace(".", "")
    .toUpperCase();
  return `${day} ${month}`;
}

type ListResponse = { schedules: Schedule[] };
type ItemResponse = { schedule: Schedule };

export function listSchedule(characterId: string): Promise<Schedule[]> {
  return get<ListResponse>(`/api/characters/${characterId}/schedule`).then(
    (r) => r.schedules,
  );
}

export function createSchedule(
  characterId: string,
  input: CreateScheduleInput,
): Promise<Schedule> {
  return post<ItemResponse>(`/api/characters/${characterId}/schedule`, input).then(
    (r) => r.schedule,
  );
}

export function updateSchedule(
  characterId: string,
  scheduleId: string,
  input: UpdateScheduleInput,
): Promise<Schedule> {
  return patch<ItemResponse>(
    `/api/characters/${characterId}/schedule/${scheduleId}`,
    input,
  ).then((r) => r.schedule);
}

export function deleteSchedule(characterId: string, scheduleId: string): Promise<void> {
  return remove<void>(`/api/characters/${characterId}/schedule/${scheduleId}`);
}