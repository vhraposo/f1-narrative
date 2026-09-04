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