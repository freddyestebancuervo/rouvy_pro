import 'package:flutter/material.dart';

/// Pantalla de carga inicial. No contiene lógica: `GoRouter.redirect`
/// (en `app_router.dart`) decide automáticamente hacia dónde navegar en
/// cuanto `authStateProvider` resuelve su primer valor.
class SplashPage extends StatelessWidget {
  const SplashPage({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            FlutterLogo(size: 64), // TODO(design): reemplazar por logo de marca
            SizedBox(height: 24),
            CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}
