import 'package:flutter/material.dart';

import '../../../../l10n/generated/app_localizations.dart';

/// Se muestra ÚNICAMENTE dentro de `DeviceManagementPage` cuando
/// `webBluetoothSupportedProvider` resuelve `false` — es decir, solo en
/// Web y solo en un navegador sin `navigator.bluetooth` (Safari, Firefox).
///
/// DECISIÓN DE ARQUITECTURA (ver `ARCHITECTURE_DECISIONS.md`, sección 4):
/// esto reemplaza el CONTENIDO de la pantalla de dispositivos, no la app
/// entera — el usuario sigue pudiendo navegar a Home, Perfil, Wearables,
/// etc. con total normalidad. La única función bloqueada es, correctamente,
/// la única que no puede funcionar sin la API del navegador: BLE.
class WebBluetoothUnavailablePage extends StatelessWidget {
  const WebBluetoothUnavailablePage({super.key});

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(Icons.bluetooth_disabled, size: 64, color: Theme.of(context).colorScheme.outline),
              const SizedBox(height: 20),
              Text(
                l10n.webBluetoothUnsupportedTitle,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 12),
              Text(
                l10n.webBluetoothUnsupportedMessage,
                textAlign: TextAlign.center,
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(color: Theme.of(context).colorScheme.outline),
              ),
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.4),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: <Widget>[
                    Icon(Icons.phone_iphone, color: Theme.of(context).colorScheme.primary),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        l10n.webBluetoothUseAppMessage,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
