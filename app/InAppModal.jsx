/**
 * InAppModal.jsx — Styled in-app popup system
 * 
 * Replaces all browser alert/confirm dialogs with a beautiful
 * gradient modal overlay. Supports:
 *   - Simple info/error/success alerts (auto-dismiss or OK button)
 *   - Confirmation dialogs (confirm/cancel with callbacks)
 *   - Navigation prompts (message + navigate button)
 *   - Custom icons, titles, messages
 * 
 * Usage:
 *   import { ModalProvider, useModal } from './InAppModal';
 *   
 *   // Wrap app root:
 *   <ModalProvider>...</ModalProvider>
 *   
 *   // Inside components:
 *   const { alert, confirm } = useModal();
 *   alert('Title', 'Message');
 *   confirm('Title', 'Message', onYes, onNo);
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Dimensions,
  Platform,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { registerModalHandler } from './app_config';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Context ────────────────────────────────────────────────────────
const ModalContext = createContext(null);

export const useModal = () => {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used within <ModalProvider>');
  return ctx;
};

// ─── Icons by type ──────────────────────────────────────────────────
const TYPE_CONFIG = {
  info:    { icon: 'ℹ️', gradient: ['#3b82f6', '#2563eb'], iconBg: 'rgba(59,130,246,0.15)' },
  success: { icon: '✅', gradient: ['#10b981', '#059669'], iconBg: 'rgba(16,185,129,0.15)' },
  error:   { icon: '❌', gradient: ['#ef4444', '#dc2626'], iconBg: 'rgba(239,68,68,0.15)' },
  warning: { icon: '⚠️', gradient: ['#f59e0b', '#d97706'], iconBg: 'rgba(245,158,11,0.15)' },
  confirm: { icon: '❓', gradient: ['#8b5cf6', '#7c3aed'], iconBg: 'rgba(139,92,246,0.15)' },
  navigate:{ icon: '🚀', gradient: ['#6366f1', '#4f46e5'], iconBg: 'rgba(99,102,241,0.15)' },
};

// ─── Determine type from title / explicit ──────────────────────────
function inferType(title, explicitType) {
  if (explicitType) return explicitType;
  const t = (title || '').toLowerCase();
  if (t.includes('error') || t.includes('fail') || t.includes('invalid') || t.includes('❌')) return 'error';
  if (t.includes('success') || t.includes('cleared') || t.includes('imported') || t.includes('✅')) return 'success';
  if (t.includes('warning') || t.includes('caution')) return 'warning';
  return 'info';
}

// ─── Provider Component ─────────────────────────────────────────────
export const ModalProvider = ({ children }) => {
  const [visible, setVisible] = useState(false);
  const [config, setConfig] = useState({
    title: '',
    message: '',
    type: 'info',
    buttons: [],
    icon: null,
  });
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.85)).current;

  const show = useCallback((cfg) => {
    setConfig(cfg);
    setVisible(true);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 8, tension: 100, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, scaleAnim]);

  const hide = useCallback((callback) => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 0.85, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      setVisible(false);
      if (callback) callback();
    });
  }, [fadeAnim, scaleAnim]);

  // ── Public API exposed via context ───────────────────────────────
  const alert = useCallback((title, message, buttons, options = {}) => {
    // Support legacy showAlert(title, message, [{text, onPress, style}])
    const resolvedButtons = (buttons && buttons.length > 0)
      ? buttons.map(b => ({
          label: b.text || b.label || 'OK',
          onPress: b.onPress || null,
          style: b.style || 'default',
        }))
      : [{ label: 'OK', style: 'default' }];

    show({
      title,
      message,
      type: inferType(title, options.type),
      buttons: resolvedButtons,
      icon: options.icon || null,
    });
  }, [show]);

  // Register with the global showAlert bridge so all components
  // that call showAlert() get routed through this modal
  useEffect(() => {
    registerModalHandler((title, message, buttons, options) => {
      alert(title, message, buttons, options);
    });
    return () => registerModalHandler(null);
  }, [alert]);

  const confirm = useCallback((title, message, onConfirm, onCancel, options = {}) => {
    show({
      title,
      message,
      type: options.type || 'confirm',
      icon: options.icon || null,
      buttons: [
        { label: options.cancelText || 'Cancel', onPress: onCancel || null, style: 'cancel' },
        { label: options.confirmText || 'Confirm', onPress: onConfirm, style: options.destructive ? 'destructive' : 'primary' },
      ],
    });
  }, [show]);

  /**
   * Show a "busy" popup with a navigate button
   * e.g. "Progressive Tuning is running" + "Go to Progressive Tuning" button
   */
  const showBusy = useCallback(({ title, message, navigateLabel, onNavigate, onDismiss }) => {
    show({
      title,
      message,
      type: 'navigate',
      icon: '🔒',
      buttons: [
        { label: 'Dismiss', onPress: onDismiss || null, style: 'cancel' },
        { label: navigateLabel || 'Go There', onPress: onNavigate, style: 'primary' },
      ],
    });
  }, [show]);

  // ── Render ───────────────────────────────────────────────────────
  const typeConf = TYPE_CONFIG[config.type] || TYPE_CONFIG.info;
  const displayIcon = config.icon || typeConf.icon;

  return (
    <ModalContext.Provider value={{ alert, confirm, showBusy }}>
      {children}

      {visible && (
        <View style={styles.overlay}>
          <Animated.View style={[styles.overlayBg, { opacity: fadeAnim }]}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} />
          </Animated.View>

          <Animated.View style={[styles.cardWrapper, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
            {/* Gradient accent bar */}
            <LinearGradient
              colors={typeConf.gradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.accentBar}
            />

            <View style={styles.card}>
              {/* Icon */}
              <View style={[styles.iconCircle, { backgroundColor: typeConf.iconBg }]}>
                <Text style={styles.iconText}>{displayIcon}</Text>
              </View>

              {/* Title */}
              {config.title ? (
                <Text style={styles.title} numberOfLines={2}>{config.title}</Text>
              ) : null}

              {/* Message (scrollable for long text) */}
              {config.message ? (
                <ScrollView style={styles.messageScroll} bounces={false} showsVerticalScrollIndicator={false}>
                  <Text style={styles.message}>{config.message}</Text>
                </ScrollView>
              ) : null}

              {/* Buttons */}
              <View style={styles.buttonRow}>
                {config.buttons.map((btn, idx) => {
                  const isPrimary = btn.style === 'primary' || btn.style === 'destructive' ||
                    (btn.style === 'default' && config.buttons.length === 1);
                  const isDestructive = btn.style === 'destructive';
                  const isCancel = btn.style === 'cancel';

                  return (
                    <TouchableOpacity
                      key={idx}
                      activeOpacity={0.7}
                      style={[
                        styles.button,
                        isPrimary && styles.buttonPrimary,
                        isDestructive && styles.buttonDestructive,
                        isCancel && styles.buttonCancel,
                        config.buttons.length === 1 && styles.buttonFull,
                      ]}
                      onPress={() => hide(btn.onPress)}
                    >
                      {isPrimary || isDestructive ? (
                        <LinearGradient
                          colors={isDestructive ? ['#ef4444', '#dc2626'] : typeConf.gradient}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={styles.buttonGradient}
                        >
                          <Text style={[styles.buttonText, styles.buttonTextPrimary]}>{btn.label}</Text>
                        </LinearGradient>
                      ) : (
                        <Text style={[styles.buttonText, isCancel && styles.buttonTextCancel]}>{btn.label}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </Animated.View>
        </View>
      )}
    </ModalContext.Provider>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────
const CARD_WIDTH = Math.min(420, SCREEN_WIDTH - 48);

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
    ...(Platform.OS === 'web' && { position: 'fixed' }),
  },
  overlayBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  cardWrapper: {
    width: CARD_WIDTH,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 20,
  },
  accentBar: {
    height: 6,
  },
  card: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 28,
    paddingTop: 28,
    paddingBottom: 24,
    alignItems: 'center',
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconText: {
    fontSize: 28,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1e293b',
    textAlign: 'center',
    marginBottom: 10,
  },
  messageScroll: {
    maxHeight: 200,
    marginBottom: 24,
    width: '100%',
  },
  message: {
    fontSize: 15,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 22,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  button: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    minHeight: 46,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonFull: {
    flex: 1,
  },
  buttonPrimary: {
    // gradient fill — handled in render
  },
  buttonDestructive: {
    // gradient fill — handled in render
  },
  buttonCancel: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  buttonGradient: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  buttonTextPrimary: {
    color: '#ffffff',
  },
  buttonTextCancel: {
    color: '#64748b',
    paddingVertical: 12,
  },
});

export default ModalProvider;
