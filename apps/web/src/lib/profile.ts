import { get, patch, postBinary, remove } from "./api";

export type ProfileTeam = {
  id: string;
  name: string;
  shortName: string | null;
  color: string | null;
};

export type ProfileDriver = {
  id: string;
  number: number | null;
  name: string;
  teamName: string | null;
  imageUrl: string | null;
};

export type UserProfile = {
  userId: string;
  displayName: string;
  email: string;
  image: string | null;
  favoriteTeam: ProfileTeam | null;
  favoriteDriver: ProfileDriver | null;
};

export type UpdateProfileInput = {
  favoriteTeamId?: string | null;
  favoriteDriverId?: string | null;
};

type ProfileResponse = { profile: UserProfile };

export function getProfile(): Promise<UserProfile> {
  return get<ProfileResponse>("/api/profile").then((r) => r.profile);
}

export function updateProfile(input: UpdateProfileInput): Promise<UserProfile> {
  return patch<ProfileResponse>("/api/profile", input).then((r) => r.profile);
}

export function uploadProfileAvatar(file: File): Promise<UserProfile> {
  return postBinary<ProfileResponse>("/api/profile/avatar", file, file.name).then(
    (r) => r.profile,
  );
}

export function deleteProfileAvatar(): Promise<void> {
  return remove<void>("/api/profile/avatar");
}
