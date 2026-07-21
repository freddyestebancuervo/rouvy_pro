import 'package:flutter/material.dart';

import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/unlocked_achievement.dart';

class AchievementCard extends StatelessWidget {
  const AchievementCard({required this.unlocked, super.key});

  final UnlockedAchievement unlocked;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool isSpanish = l10n.localeName.startsWith('es');
    final String title = isSpanish ? unlocked.achievement.titleEs : unlocked.achievement.titleEn;

    final ColorScheme colors = Theme.of(context).colorScheme;

    return Card(
      color: unlocked.isUnlocked ? colors.primaryContainer.withValues(alpha: 0.5) : null,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(
              unlocked.isUnlocked ? Icons.emoji_events : Icons.lock_outline,
              color: unlocked.isUnlocked ? colors.primary : colors.outline,
              size: 28,
            ),
            const SizedBox(height: 10),
            Text(
              title,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    fontWeight: unlocked.isUnlocked ? FontWeight.w700 : FontWeight.w400,
                    color: unlocked.isUnlocked ? null : colors.outline,
                  ),
            ),
            const Spacer(),
            if (!unlocked.isUnlocked) ...<Widget>[
              const SizedBox(height: 10),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: unlocked.progress,
                  minHeight: 5,
                  backgroundColor: colors.surfaceContainerHighest,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
