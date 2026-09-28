"use client";

import { ProfileSettings } from "@/components/profile/profile-settings";
import { PageHeader } from "@/components/ui/page-header";

export default function ProfilePage() {
  return (
    <div className="space-y-8">
      <PageHeader
        kicker="Conta"
        title="Perfil"
        description="Nome público, foto e favoritos do seu perfil."
      />
      <ProfileSettings />
    </div>
  );
}
