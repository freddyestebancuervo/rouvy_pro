/// Formatea una duración como `mm:ss` (sesiones cortas) o `hh:mm:ss` (una
/// vez superada la hora) — separado del widget del HUD para poder
/// testearlo sin necesidad de un `WidgetTester`.
abstract class DurationFormatter {
  static String format(Duration duration) {
    final int hours = duration.inHours;
    final int minutes = duration.inMinutes.remainder(60);
    final int seconds = duration.inSeconds.remainder(60);

    final String mm = minutes.toString().padLeft(2, '0');
    final String ss = seconds.toString().padLeft(2, '0');

    if (hours > 0) {
      final String hh = hours.toString().padLeft(2, '0');
      return '$hh:$mm:$ss';
    }
    return '$mm:$ss';
  }
}
