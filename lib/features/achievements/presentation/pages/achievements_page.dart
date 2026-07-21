import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/unlocked_achievement.dart';
import '../providers/achievements_providers.dart';
import '../widgets/achievement_card.dart';

class AchievementsPage extends ConsumerWidget {
  const AchievementsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<List<UnlockedAchievement>> state = ref.watch(achievementsProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.achievementsTitle)),
      body: SafeArea(
        child: state.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (Object error, StackTrace stackTrace) => Center(child: Text(l10n.genericErrorMessage)),
          data: (List<UnlockedAchievement> achievements) {
            // Desbloqueados primero — un usuario nuevo con todo bloqueado
            // ve igual el catálogo completo (motiva a seguir entrenando
            // para desbloquear el resto), pero alguien con logros ya
            // ganados los ve de un vistazo arriba, sin scrollear.
            final List<UnlockedAchievement> sorted = [...achievements]
              ..sort((a, b) => (a.isUnlocked ? 0 : 1).compareTo(b.isUnlocked ? 0 : 1));

            final int unlockedCount = achievements.where((UnlockedAchievement a) => a.isUnlocked).length;

            return Column(
              children: <Widget>[
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
                  child: Row(
                    children: <Widget>[
                      Icon(Icons.emoji_events_outlined, color: Theme.of(context).colorScheme.primary),
                      const SizedBox(width: 8),
                      Text(
                        l10n.achievementsProgressLabel(unlockedCount, achievements.length),
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: GridView.builder(
                    padding: const EdgeInsets.all(20),
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      crossAxisSpacing: 12,
                      mainAxisSpacing: 12,
                      childAspectRatio: 1.1,
                    ),
                    itemCount: sorted.length,
                    itemBuilder: (BuildContext context, int index) => AchievementCard(unlocked: sorted[index]),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
