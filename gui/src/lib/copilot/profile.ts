/** Los ids de los logros del perfil (experiencias, proyectos y transversales), para elegir «solo estos». */
import type { ProfileResponse } from '../api/types';

export interface AchievementOption {
  readonly id: string;
  readonly where: string;
  readonly text: string;
}

export function achievementOptions(profile: ProfileResponse): readonly AchievementOption[] {
  return [
    ...profile.experience.flatMap((item) => item.achievements.map((achievement) => ({ id: achievement.id, where: `${item.role} · ${item.company}`, text: achievement.text }))),
    ...profile.projects.flatMap((item) => item.achievements.map((achievement) => ({ id: achievement.id, where: `Proyecto ${item.name}`, text: achievement.text }))),
    ...profile.achievements.map((achievement) => ({ id: achievement.id, where: 'Logros transversales', text: achievement.text })),
  ];
}
