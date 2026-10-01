import type { ExternalKnowledgeProvider } from "@prisma/client";

import type { BiographyFacts } from "../pilot-knowledge.profile.js";

export type DriverIdentityQuery = {
  readonly name: string;
  readonly fullName?: string | null;
  readonly nationality?: string | null;
  readonly number?: number | null;
  readonly dateOfBirth?: Date | null;
  readonly wikidataQid?: string | null;
  readonly f1dbDriverId?: string | null;
  readonly externalId?: string | null;
};

export type ProviderIdentityCandidate = {
  readonly externalId: string;
  readonly name: string;
  readonly fullName?: string | null;
  readonly nationality?: string | null;
  readonly number?: number | null;
  readonly dateOfBirth?: Date | null;
  readonly wikidataQid?: string | null;
  readonly f1dbDriverId?: string | null;
};

export type ProviderSourceReference = {
  readonly provider: ExternalKnowledgeProvider;
  readonly sourceKind:
    | "STRUCTURED_RELEASE"
    | "OFFICIAL_PROFILE"
    | "INTERVIEW"
    | "PRESS_CONFERENCE"
    | "BIOGRAPHY_PAGE"
    | "NEWS_REPORT"
    | "DATABASE_EXPORT"
    | "PUBLIC_STATEMENT";
  readonly url?: string | null;
  readonly title?: string | null;
  readonly license:
    | "CC_BY_4_0"
    | "CC0"
    | "CC_BY_SA_4_0"
    | "PROPRIETARY_REFERENCE_ONLY"
    | "UNKNOWN";
  readonly attributionRequirement?: string | null;
  readonly attributionText?: string | null;
  readonly publishedAt?: Date | null;
  readonly sourceVersion?: string | null;
  readonly metadata?: Record<string, unknown> | null;
};

export type ProviderStructuredProfile = {
  readonly fullName: string | null;
  readonly publicName: string | null;
  readonly dateOfBirth: Date | null;
  readonly placeOfBirth: string | null;
  readonly nationality: string | null;
  readonly representedCountry: string | null;
  readonly driverNumber: number | null;
  readonly driverCode: string | null;
  readonly currentTeamName: string | null;
  readonly officialLinks: Record<string, string> | null;
  readonly biographyFacts: BiographyFacts;
};

export type ProviderRelationship = {
  readonly kind:
    | "ROMANTIC_PARTNER"
    | "SPOUSE"
    | "PARENT"
    | "CHILD"
    | "SIBLING"
    | "TEAMMATE"
    | "TEAM_RELATION"
    | "MENTOR"
    | "OTHER_PUBLIC_RELATION";
  readonly targetType: "DRIVER" | "PUBLIC_PERSON";
  readonly targetExternalId?: string | null;
  readonly targetWikidataQid?: string | null;
  readonly displayName: string;
  readonly state: "ACTIVE" | "ENDED" | "UNKNOWN";
  readonly validFrom?: Date | null;
  readonly validTo?: Date | null;
};

export type ProviderCareerData = {
  readonly seasons: ReadonlyArray<{
    readonly year: number;
    readonly teamName: string | null;
    readonly number: number | null;
  }>;
  readonly championships: readonly number[];
};

export type ProviderProfileResult = {
  readonly profile: ProviderStructuredProfile;
  readonly source: ProviderSourceReference;
};

export type ExternalDriverKnowledgeProvider = {
  readonly source: ExternalKnowledgeProvider;
  resolveDriverIdentity(query: DriverIdentityQuery): Promise<ProviderIdentityCandidate[]>;
  fetchStructuredProfile(candidate: ProviderIdentityCandidate): Promise<ProviderProfileResult>;
  fetchRelationships(candidate: ProviderIdentityCandidate): Promise<ProviderRelationship[]>;
  fetchCareerData(candidate: ProviderIdentityCandidate): Promise<ProviderCareerData>;
  fetchSourceReferences(candidate: ProviderIdentityCandidate): Promise<ProviderSourceReference[]>;
};
