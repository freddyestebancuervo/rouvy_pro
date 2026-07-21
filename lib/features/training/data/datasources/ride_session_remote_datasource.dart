import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart' as fb;

import '../../../../core/error/exceptions.dart';
import '../models/ride_session_record_model.dart';

abstract class RideSessionRemoteDataSource {
  Future<void> saveSession(RideSessionRecordModel record);

  Stream<List<RideSessionRecordModel>> get recentSessions;
}

class RideSessionRemoteDataSourceImpl implements RideSessionRemoteDataSource {
  RideSessionRemoteDataSourceImpl({
    required FirebaseFirestore firestore,
    required fb.FirebaseAuth firebaseAuth,
  })  : _firestore = firestore,
        _firebaseAuth = firebaseAuth;

  final FirebaseFirestore _firestore;
  final fb.FirebaseAuth _firebaseAuth;

  static const int _recentSessionsLimit = 30;

  /// Se guarda como subcolección de cada usuario (`users/{uid}/ride_sessions`)
  /// en vez de una colección global `ride_sessions` con un campo `userId` —
  /// así las reglas de seguridad de Firestore para "solo el dueño puede
  /// leer/escribir sus propias sesiones" son una única regla por ruta
  /// (`match /users/{uid}/ride_sessions/{sessionId}`), sin tener que
  /// filtrar por campo en cada query ni depender de que el cliente nunca
  /// mande un `userId` incorrecto.
  CollectionReference<Map<String, dynamic>> _collectionFor(String uid) {
    return _firestore.collection('users').doc(uid).collection('ride_sessions');
  }

  @override
  Future<void> saveSession(RideSessionRecordModel record) async {
    final fb.User? user = _firebaseAuth.currentUser;
    if (user == null) {
      throw const ServerException('No hay una sesión activa para guardar el entrenamiento.');
    }
    await _collectionFor(user.uid).add(record.toMap());
  }

  @override
  Stream<List<RideSessionRecordModel>> get recentSessions {
    final fb.User? user = _firebaseAuth.currentUser;
    if (user == null) return Stream<List<RideSessionRecordModel>>.value(const <RideSessionRecordModel>[]);

    return _collectionFor(user.uid)
        .orderBy('startTime', descending: true)
        .limit(_recentSessionsLimit)
        .snapshots()
        .map((QuerySnapshot<Map<String, dynamic>> snapshot) {
      return snapshot.docs
          .map((doc) => RideSessionRecordModel.fromMap(doc.data(), doc.id))
          .toList(growable: false);
    });
  }
}
