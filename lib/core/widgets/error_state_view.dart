import 'package:flutter/material.dart';

import '../error/failures.dart';
import '../../l10n/generated/app_localizations.dart';

/// Estado de error reutilizable. Si [failure] es un [NetworkFailure]
/// específicamente, cambia el ícono y el mensaje para dejar claro que es
/// un problema de conexión y no un fallo de la app — distinción que
/// también pedía el punto 12 del encargo ("estados... de error y sin
/// conexión" como cosas separadas).
class ErrorStateView extends StatelessWidget {
  const ErrorStateView({this.failure, this.message, this.onRetry, super.key})
      : assert(failure != null || message != null, 'Debe proveerse failure o message');

  final Failure? failure;
  final String? message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool isOffline = failure is NetworkFailure;
    final String displayMessage = message ?? failure?.message ?? l10n.genericErrorMessage;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(
              isOffline ? Icons.wifi_off : Icons.error_outline,
              size: 48,
              color: Theme.of(context).colorScheme.error,
            ),
            const SizedBox(height: 16),
            Text(
              displayMessage,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            if (onRetry != null) ...<Widget>[
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: Text(l10n.retryAction),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
