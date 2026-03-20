import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Image, Modal, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AppConfig, { PathUtils, showAlert } from './app_config';

const formatNumber = (value, digits = 3) => {
  if (value == null || Number.isNaN(value)) return 'N/A';
  if (typeof value !== 'number') return String(value);
  return value.toFixed(digits);
};

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const { width } = Dimensions.get('window');

const ZoomableChart = ({ title, uri }) => {
  const [modalVisible, setModalVisible] = useState(false);

  if (!uri) return null;

  return (
    <View style={styles.chartWrap}>
      <Text style={styles.metricTitle}>{title}</Text>

      <TouchableOpacity activeOpacity={0.9} onPress={() => setModalVisible(true)}>
        <Image source={{ uri }} style={styles.chartImage} resizeMode="contain" />
        <View style={styles.zoomHint}>
          <Text style={styles.zoomHintText}>Tap to zoom</Text>
        </View>
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <ScrollView
            contentContainerStyle={styles.modalScrollContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
          >
            <Image source={{ uri }} style={styles.modalImage} resizeMode="contain" />
          </ScrollView>

          <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setModalVisible(false)}>
            <Text style={styles.modalCloseBtnText}>X</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
};

const buildFrequencyRows = (result) => {
  const allPoints = [result?.s11 || [], result?.ar || [], result?.gain || []];
  const maxLength = Math.max(...allPoints.map((arr) => arr.length), 0);
  const rows = [];

  for (let index = 0; index < maxLength; index += 1) {
    const s11Point = result?.s11?.[index] || null;
    const arPoint = result?.ar?.[index] || null;
    const gainPoint = result?.gain?.[index] || null;
    const frequency =
      toNumber(s11Point?.frequency)
      ?? toNumber(arPoint?.frequency)
      ?? toNumber(gainPoint?.frequency)
      ?? null;

    rows.push({
      key: `freq-${index}`,
      frequency,
      s11: toNumber(s11Point?.value),
      ar: toNumber(arPoint?.value),
      gain: toNumber(gainPoint?.value),
    });
  }

  return rows.slice(0, 3);
};

const VariableValueList = ({ values }) => {
  if (!Array.isArray(values) || values.length === 0) {
    return <Text style={styles.emptyText}>Variable values unavailable</Text>;
  }

  return (
    <View style={styles.metricGroup}>
      <Text style={styles.metricTitle}>Tuning Variables</Text>
      <View style={styles.variableGrid}>
        {values.map((item) => (
          <View key={item.name} style={styles.variableCard}>
            <Text style={styles.variableName}>{item.name}</Text>
            <Text style={styles.variableValue}>{formatNumber(item.value)}{item.unit || ''}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

const AntennaMiniMap = ({ gndSetting, antennaPosition, compact = false }) => {
  const ANTENNA_SIZE_MM = 25;
  const planeX = Number(gndSetting?.Lgx || 0);
  const planeY = Number(gndSetting?.Lgy || 0);

  if (!(planeX > 0 && planeY > 0)) {
    return (
      <View style={styles.miniMapWrap}>
        <Text style={styles.emptyText}>Ground plane dimensions unavailable</Text>
      </View>
    );
  }

  const maxWidth = compact ? 240 : 320;
  const maxHeight = compact ? 140 : 200;
  const scale = Math.min(maxWidth / planeX, maxHeight / planeY);
  const width = Math.max(compact ? 140 : 160, planeX * scale);
  const height = Math.max(compact ? 90 : 110, planeY * scale);

  const antennaX = Number(antennaPosition?.x ?? gndSetting?.GND_xPos ?? 0);
  const antennaY = Number(antennaPosition?.y ?? gndSetting?.GND_yPos ?? 0);

  const px = Math.max(0, Math.min(width, (antennaX / planeX) * width));
  const py = Math.max(0, Math.min(height, (antennaY / planeY) * height));

  const antennaWidthPx = Math.max(12, (ANTENNA_SIZE_MM / planeX) * width);
  const antennaHeightPx = Math.max(12, (ANTENNA_SIZE_MM / planeY) * height);
  const antennaLeft = Math.max(0, Math.min(width - antennaWidthPx, px - (antennaWidthPx / 2)));
  const antennaTop = Math.max(0, Math.min(height - antennaHeightPx, py - (antennaHeightPx / 2)));

  const leftClearance = Math.max(0, antennaX - (ANTENNA_SIZE_MM / 2));
  const rightClearance = Math.max(0, planeX - (antennaX + (ANTENNA_SIZE_MM / 2)));
  const bottomClearance = Math.max(0, antennaY - (ANTENNA_SIZE_MM / 2));
  const topClearance = Math.max(0, planeY - (antennaY + (ANTENNA_SIZE_MM / 2)));

  return (
    <View style={styles.miniMapWrap}>
      <View style={[styles.miniMapPlane, { width, height }]}>
        <View style={[styles.guideVertical, { left: px - 0.5 }]} />
        <View style={[styles.guideHorizontal, { top: py - 0.5 }]} />

        <View style={[styles.antennaFootprint, { left: antennaLeft, top: antennaTop, width: antennaWidthPx, height: antennaHeightPx }]}>
          {!compact && <Text style={styles.antennaFootprintLabel}>25×25</Text>}
        </View>

        <View style={[styles.miniMapDot, { left: px - 5, top: py - 5 }]} />

        <Text style={styles.cornerLabelBottomLeft}>(0,0)</Text>
        <Text style={styles.cornerLabelBottomRight}>({formatNumber(planeX, 0)},0)</Text>
        <Text style={styles.cornerLabelTopLeft}>(0,{formatNumber(planeY, 0)})</Text>
        <Text style={styles.cornerLabelTopRight}>({formatNumber(planeX, 0)},{formatNumber(planeY, 0)})</Text>
      </View>

      <Text style={styles.miniMapCaption}>Antenna center: ({formatNumber(antennaX, 2)}, {formatNumber(antennaY, 2)}) mm</Text>
      {!compact && (
        <>
          <Text style={styles.miniMapCaption}>Antenna footprint: {ANTENNA_SIZE_MM} × {ANTENNA_SIZE_MM} mm</Text>
          <Text style={styles.miniMapCaption}>Ground plane: {formatNumber(planeX, 2)} × {formatNumber(planeY, 2)} mm</Text>
          <Text style={styles.miniMapCaption}>
            Edge clearances (mm) — Left: {formatNumber(leftClearance, 2)} | Right: {formatNumber(rightClearance, 2)} | Bottom: {formatNumber(bottomClearance, 2)} | Top: {formatNumber(topClearance, 2)}
          </Text>
        </>
      )}
    </View>
  );
};

const ProfileBrowseCard = ({ profile, onPress, onDelete, deleting }) => (
  <TouchableOpacity style={styles.profileBrowseCard} onPress={onPress}>
    <View style={styles.profileBrowseHeader}>
      <View style={{ flex: 1 }}>
        <Text style={styles.profileBrowseTitle}>{profile.profileName || profile.profileId}</Text>
        <Text style={styles.profileBrowseMeta}>ID: {profile.profileId}</Text>
        <Text style={styles.profileBrowseMeta}>Created: {profile.createdAt || 'N/A'}</Text>
      </View>
      <View style={styles.profileHeaderRight}>
        <Text style={[styles.validityBadge, profile.valid ? styles.validBadge : styles.invalidBadge]}>
          {profile.valid ? 'Valid' : 'Invalid'}
        </Text>
        <TouchableOpacity
          style={[styles.deleteProfileButton, deleting && styles.deleteProfileButtonDisabled]}
          onPress={onDelete}
          disabled={deleting}
        >
          <Text style={styles.deleteProfileButtonText}>{deleting ? 'Deleting...' : 'Delete'}</Text>
        </TouchableOpacity>
      </View>
    </View>

    <View style={styles.profileBrowseInfoRow}>
      <Text style={styles.profileBrowseInfoText}>Iterations: {profile.totalIterations || 0}</Text>
      <Text style={styles.profileBrowseInfoText}>Mode: {profile.gndSetting?.mode || 'N/A'}</Text>
      <Text style={styles.profileBrowseInfoText}>Status: {profile.status || 'N/A'}</Text>
    </View>

    <AntennaMiniMap
      gndSetting={profile.gndSetting}
      antennaPosition={profile.antennaPosition}
      compact
    />

    <Text style={styles.profileBrowseHint}>Tap to open profile details</Text>
  </TouchableOpacity>
);

const DetailInfoBlock = ({ selectedProfile }) => (
  <View style={styles.detailInfoCard}>
    <Text style={styles.detailRow}><Text style={styles.detailLabel}>Profile ID:</Text> {selectedProfile.profileId}</Text>
    <Text style={styles.detailRow}><Text style={styles.detailLabel}>Status:</Text> {selectedProfile.status}</Text>
    <Text style={styles.detailRow}><Text style={styles.detailLabel}>Reason:</Text> {selectedProfile.reason}</Text>
    <Text style={styles.detailRow}><Text style={styles.detailLabel}>Created:</Text> {selectedProfile.createdAt}</Text>
    <Text style={styles.detailRow}><Text style={styles.detailLabel}>Variables:</Text> {(selectedProfile.variableSetting?.variableIds || []).join(', ') || 'N/A'}</Text>
  </View>
);

const OptimalCard = ({ title, result, solutionType, onRunVerification, verificationBusy }) => {
  if (!result) {
    return (
      <View style={styles.optimalCard}>
        <Text style={styles.optimalTitle}>{title}</Text>
        <Text style={styles.emptyText}>No available data</Text>
      </View>
    );
  }

  const frequencyRows = buildFrequencyRows(result);

  return (
    <View style={styles.optimalCard}>
      <Text style={styles.optimalTitle}>{title}</Text>

      <View style={styles.metricIterationCard}>
        <LinearGradient colors={['#f8fafc', '#e2e8f0']} style={styles.metricIterationCardGradient}>
          <Text style={styles.metricIterationTitle}>Iteration {result.iteration}</Text>
          <View style={styles.metricIterationGrid}>
            {frequencyRows.map((row) => (
              <View key={row.key} style={styles.metricFrequencySection}>
                <Text style={styles.metricFrequencyHeader}>
                  {row.frequency == null ? 'N/A' : `${formatNumber(row.frequency, 3)} GHz`}
                </Text>
                <View style={styles.metricParameterRow}>
                  <Text style={styles.metricParameterLabel}>S11:</Text>
                  <Text style={styles.metricParameterValue}>{row.s11 == null ? 'N/A' : `${formatNumber(row.s11)} dB`}</Text>
                </View>
                <View style={styles.metricParameterRow}>
                  <Text style={styles.metricParameterLabel}>AR:</Text>
                  <Text style={styles.metricParameterValue}>{row.ar == null ? 'N/A' : formatNumber(row.ar)}</Text>
                </View>
                <View style={styles.metricParameterRow}>
                  <Text style={styles.metricParameterLabel}>Gain:</Text>
                  <Text style={styles.metricParameterValue}>{row.gain == null ? 'N/A' : `${formatNumber(row.gain)} dBi`}</Text>
                </View>
              </View>
            ))}
          </View>
        </LinearGradient>
      </View>

      <Text style={styles.detailRow}><Text style={styles.detailLabel}>AR &lt; 3dB:</Text> {formatNumber(result.arBelow3Pct, 2)}%</Text>
      <Text style={styles.detailRow}><Text style={styles.detailLabel}>AR @ 1.575GHz:</Text> {formatNumber(result.arAt1575)}</Text>
      <VariableValueList values={result.variableValues} />

      <TouchableOpacity
        style={[styles.verifyButton, verificationBusy && styles.verifyButtonDisabled]}
        onPress={() => onRunVerification(solutionType)}
        disabled={verificationBusy}
      >
        <Text style={styles.verifyButtonText}>
          {verificationBusy ? 'Verification Running...' : 'Run Full HFSS Verification Sweep'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

export default function MoeaProfileViewer({ onBack, projectPath, initialVerificationContext = null }) {
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [deletingProfileId, setDeletingProfileId] = useState(null);
  const [isStopping, setIsStopping] = useState(false);
  const [chartNonce, setChartNonce] = useState(0);
  const [verificationState, setVerificationState] = useState({
    runId: null,
    solutionType: null,
    status: null,
    message: null,
    summary: null,
    resultLocations: null,
  });

  const projectDir = useMemo(() => {
    if (!projectPath) return null;
    return PathUtils.getProjectRoot(projectPath);
  }, [projectPath]);

  const resetSelectionState = () => {
    setSelectedProfile(null);
    setSelectedProfileId(null);
    setVerificationState({
      runId: null,
      solutionType: null,
      status: null,
      message: null,
      summary: null,
      resultLocations: null,
    });
  };

  const loadLatestVerificationForProfile = async (profileId) => {
    if (!projectDir || !profileId) return;
    try {
      const url = `${AppConfig.serverUrl}/api/integrated-results/profiles/${encodeURIComponent(profileId)}/verify-latest?projectPath=${encodeURIComponent(projectDir)}`;
      const response = await fetch(url);
      const data = await response.json();
      if (!data.success || !data.data) return;

      setVerificationState((prev) => ({
        ...prev,
        runId: data.data.runId || prev.runId || null,
        solutionType: data.data.solutionType || prev.solutionType || null,
        status: data.data.status || prev.status || null,
        message: data.data.message || prev.message || null,
        summary: data.data.summary || prev.summary || null,
        resultLocations: data.data.resultLocations || prev.resultLocations || null,
      }));

      if ((data.data.status || '').toLowerCase() === 'completed') {
        setChartNonce((prev) => prev || Date.now());
      }
    } catch {
    }
  };

  const loadProfiles = async () => {
    if (!projectDir) return;
    setLoading(true);
    try {
      const url = `${AppConfig.serverUrl}/api/integrated-results/profiles?projectPath=${encodeURIComponent(projectDir)}`;
      const response = await fetch(url);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Could not load profiles');
      }

      const list = data.data?.profiles || [];
      setProfiles(list);
      resetSelectionState();
    } catch (error) {
      showAlert('MOEA Profiles', `Failed to load profiles: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (profileId, options = {}) => {
    const { preserveVerification = false } = options;
    if (!projectDir || !profileId) return;
    setSelectedProfileId(profileId);
    setLoadingDetail(true);
    if (!preserveVerification) {
      setVerificationState({
        runId: null,
        solutionType: null,
        status: null,
        message: null,
        summary: null,
        resultLocations: null,
      });
    }

    try {
      const url = `${AppConfig.serverUrl}/api/integrated-results/profiles/${encodeURIComponent(profileId)}?projectPath=${encodeURIComponent(projectDir)}`;
      const response = await fetch(url);
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || 'Could not load profile detail');
      }
      setSelectedProfile(data.data?.profile || null);
      await loadLatestVerificationForProfile(profileId);
    } catch (error) {
      showAlert('MOEA Profiles', `Failed to load profile detail: ${error.message}`);
    } finally {
      setLoadingDetail(false);
    }
  };

  const deleteProfile = (profile) => {
    if (!projectDir || !profile?.profileId) return;

    showAlert(
      'Delete Profile',
      `Delete profile "${profile.profileName || profile.profileId}"?\n\nThis cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingProfileId(profile.profileId);
            try {
              const url = `${AppConfig.serverUrl}/api/integrated-results/profiles/${encodeURIComponent(profile.profileId)}?projectPath=${encodeURIComponent(projectDir)}`;
              const response = await fetch(url, { method: 'DELETE' });
              const data = await response.json();
              if (!data.success) {
                throw new Error(data.message || 'Could not delete profile');
              }

              setProfiles((prev) => prev.filter((item) => item.profileId !== profile.profileId));
              if (selectedProfileId === profile.profileId) {
                resetSelectionState();
              }
            } catch (error) {
              showAlert('Delete Failed', `Could not delete profile: ${error.message}`);
            } finally {
              setDeletingProfileId(null);
            }
          }
        }
      ]
    );
  };

  useEffect(() => {
    loadProfiles();
  }, [projectDir]);

  useEffect(() => {
    const ctx = initialVerificationContext;
    if (!projectDir || !ctx?.profileId || !ctx?.runId) return;

    const applyRestore = async () => {
      await loadDetail(ctx.profileId, { preserveVerification: true });

      setVerificationState((prev) => ({
        ...prev,
        runId: ctx.runId,
        solutionType: ctx.solutionType || prev.solutionType || null,
        status: ctx.status || prev.status || 'running',
        message: ctx.message || prev.message || 'Restored verification session',
        summary: ctx.summary || prev.summary || null,
        resultLocations: ctx.resultLocations || prev.resultLocations || null,
      }));

      try {
        const url = `${AppConfig.serverUrl}/api/integrated-results/profiles/${encodeURIComponent(ctx.profileId)}/verify-status?projectPath=${encodeURIComponent(projectDir)}&runId=${encodeURIComponent(ctx.runId)}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.success && data.data) {
          setVerificationState((prev) => ({
            ...prev,
            status: data.data.status,
            message: data.data.message,
            summary: data.data.summary || prev.summary || null,
            resultLocations: data.data.resultLocations || prev.resultLocations || null,
          }));
          if ((data.data.status || '').toLowerCase() === 'completed') {
            setChartNonce(Date.now());
          }
        }
      } catch {
      }
    };

    applyRestore();
  }, [projectDir, initialVerificationContext?.profileId, initialVerificationContext?.runId]);

  useEffect(() => {
    if (!projectDir || !selectedProfile?.profileId || !verificationState?.runId) return;
    if (!['starting', 'running', 'stopping'].includes(verificationState.status)) return;

    const poll = async () => {
      try {
        const url = `${AppConfig.serverUrl}/api/integrated-results/profiles/${encodeURIComponent(selectedProfile.profileId)}/verify-status?projectPath=${encodeURIComponent(projectDir)}&runId=${encodeURIComponent(verificationState.runId)}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.success && data.data) {
          setVerificationState((prev) => {
            const nextStatus = data.data.status;
            const nextMessage = data.data.message;
            const nextSummary = data.data.summary || null;
            const nextLocations = data.data.resultLocations || prev.resultLocations || null;

            const sameSummary = JSON.stringify(prev.summary || null) === JSON.stringify(nextSummary || null);
            const sameLocations = JSON.stringify(prev.resultLocations || null) === JSON.stringify(nextLocations || null);

            if (
              prev.status === nextStatus &&
              prev.message === nextMessage &&
              sameSummary &&
              sameLocations
            ) {
              return prev;
            }

            return {
              ...prev,
              status: nextStatus,
              message: nextMessage,
              summary: nextSummary || prev.summary || null,
              resultLocations: nextLocations,
            };
          });
          if ((data.data.status || '').toLowerCase() === 'completed') {
            setChartNonce((prev) => prev || Date.now());
          }
        }
      } catch {
      }
    };

    const timer = setInterval(poll, 5000);
    poll();
    return () => clearInterval(timer);
  }, [projectDir, selectedProfile, verificationState.runId, verificationState.status]);

  const startVerification = async (solutionType) => {
    if (!projectDir || !selectedProfile?.profileId) return;

    try {
      setVerificationState((prev) => ({
        ...prev,
        runId: null,
        solutionType,
        status: 'starting',
        message: 'Starting verification...',
      }));

      const url = `${AppConfig.serverUrl}/api/integrated-results/profiles/${encodeURIComponent(selectedProfile.profileId)}/verify`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: projectDir,
          solutionType,
        }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || 'Failed to start verification');
      }

      setVerificationState({
        runId: data.data.runId,
        solutionType,
        status: 'running',
        message: 'Verification running in MATLAB/HFSS...',
        summary: null,
        resultLocations: data.data.resultLocations || null,
      });
      setChartNonce(0);
    } catch (error) {
      setVerificationState((prev) => ({
        ...prev,
        status: 'error',
        message: error.message,
      }));
      showAlert('Verification', `Failed to start verification: ${error.message}`);
    }
  };

  const handleStopVerification = async () => {
    setIsStopping(true);
    try {
      const response = await fetch(`${AppConfig.serverUrl}/api/matlab/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Failed to stop MATLAB/HFSS processes');
      }

      showAlert('Stop Requested', 'MATLAB and HFSS stop signal sent. Waiting for verification status update...');
      setVerificationState((prev) => ({
        ...prev,
        status: 'stopping',
        message: 'Stopping MATLAB/HFSS processes...'
      }));
    } catch (error) {
      showAlert('Stop Failed', `Could not stop verification: ${error.message}`);
    } finally {
      setIsStopping(false);
    }
  };

  const isVerificationBusy = ['starting', 'running', 'stopping'].includes(verificationState.status);
  const isDetailPage = !!selectedProfile;
  const selectedSolutionType = verificationState.solutionType || null;
  const showBalancedCard = !selectedSolutionType || selectedSolutionType === 'balanced';
  const showOptimalCard = !selectedSolutionType || selectedSolutionType === 'optimal';

  const handleBackAction = () => {
    if (isDetailPage) {
      resetSelectionState();
      return;
    }
    onBack();
  };

  const chartUrl = (chartName) => {
    if (!verificationState?.runId || !projectDir || !selectedProfile?.profileId) return null;
    const cacheKey = chartNonce || verificationState.runId;
    return `${AppConfig.serverUrl}/api/integrated-results/profiles/${encodeURIComponent(selectedProfile.profileId)}/verify-chart/${encodeURIComponent(chartName)}?projectPath=${encodeURIComponent(projectDir)}&runId=${encodeURIComponent(verificationState.runId)}&v=${encodeURIComponent(String(cacheKey))}`;
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#0ea5e9', '#0284c7']} style={styles.header}>
        <TouchableOpacity onPress={handleBackAction} style={styles.backButton}>
          <Text style={styles.backButtonText}>{isDetailPage ? 'Back to Profiles' : 'Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>MOEA Profiles</Text>
        <TouchableOpacity onPress={loadProfiles} style={styles.refreshButton}>
          <Text style={styles.refreshButtonText}>Refresh</Text>
        </TouchableOpacity>
      </LinearGradient>

      <View style={styles.projectBanner}>
        <Text style={styles.projectBannerText}>Project: {projectDir || 'Not set'}</Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0284c7" />
          <Text style={styles.loadingText}>Loading profiles...</Text>
        </View>
      ) : !isDetailPage ? (
        <ScrollView style={styles.content}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Profile Selection ({profiles.length})</Text>
            {profiles.length === 0 && (
              <Text style={styles.emptyText}>No profile snapshots found yet.</Text>
            )}

            {(profiles || []).map((profile) => (
              <ProfileBrowseCard
                key={profile.profileId}
                profile={profile}
                onPress={() => loadDetail(profile.profileId)}
                onDelete={() => deleteProfile(profile)}
                deleting={deletingProfileId === profile.profileId}
              />
            ))}
          </View>
        </ScrollView>
      ) : (
        <ScrollView style={styles.content}>
          {loadingDetail && (
            <View style={styles.centeredSmall}>
              <ActivityIndicator size="small" color="#0284c7" />
              <Text style={styles.loadingText}>Loading profile detail...</Text>
            </View>
          )}

          {selectedProfile && !loadingDetail && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Profile Detail</Text>
              <Text style={styles.detailHeaderName}>{selectedProfile.profileName || selectedProfile.profileId}</Text>

              <View style={styles.optimalCard}>
                <Text style={styles.optimalTitle}>Ground Plane / Antenna Context</Text>
                <Text style={styles.detailRow}><Text style={styles.detailLabel}>Mode:</Text> {selectedProfile.gndSetting?.mode || 'N/A'}</Text>
                <AntennaMiniMap gndSetting={selectedProfile.gndSetting} antennaPosition={selectedProfile.antennaPosition} />
              </View>

              <DetailInfoBlock selectedProfile={selectedProfile} />

              {showBalancedCard && (
                <OptimalCard
                  title="Balanced Optimal"
                  result={selectedProfile.optimalResults?.balanced}
                  solutionType="balanced"
                  onRunVerification={startVerification}
                  verificationBusy={isVerificationBusy}
                />
              )}

              {showOptimalCard && (
                <OptimalCard
                  title="Overall Optimal"
                  result={selectedProfile.optimalResults?.optimal}
                  solutionType="optimal"
                  onRunVerification={startVerification}
                  verificationBusy={isVerificationBusy}
                />
              )}

              <View style={styles.optimalCard}>
                <Text style={styles.optimalTitle}>Verification Result</Text>
                <Text style={styles.detailRow}><Text style={styles.detailLabel}>Solution:</Text> {verificationState.solutionType || 'N/A'}</Text>
                <Text style={styles.detailRow}><Text style={styles.detailLabel}>Status:</Text> {verificationState.status || 'not started'}</Text>
                <Text style={styles.detailRow}><Text style={styles.detailLabel}>Message:</Text> {verificationState.message || 'No verification run yet'}</Text>

                {['starting', 'running', 'stopping'].includes(verificationState.status) && (
                  <View style={styles.controlRow}>
                    <View style={[styles.controlButton, styles.runningButton]}>
                      <Text style={styles.runningButtonText}>
                        {verificationState.status === 'stopping' ? '⏳ Stopping...' : '🔄 Running'}
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={[styles.controlButton, styles.stopButton, isStopping && styles.stopButtonDisabled]}
                      disabled={isStopping || verificationState.status === 'stopping'}
                      onPress={() => {
                        showAlert(
                          'Stop Verification',
                          'This will terminate MATLAB and HFSS for the current verification run. Current verification progress will be lost.',
                          [
                            { text: 'No', style: 'cancel' },
                            { text: 'Yes, Stop', onPress: handleStopVerification, style: 'destructive' },
                          ]
                        );
                      }}
                    >
                      <Text style={styles.controlButtonText}>
                        {isStopping || verificationState.status === 'stopping' ? '⏳ Stopping...' : '⛔ Stop'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                {verificationState.summary && (
                  <>
                    <Text style={styles.detailRow}><Text style={styles.detailLabel}>S11 @1.575:</Text> {formatNumber(verificationState.summary.s11_1575)} dB</Text>
                    <Text style={styles.detailRow}><Text style={styles.detailLabel}>AR @1.575:</Text> {formatNumber(verificationState.summary.ar_1575)}</Text>
                    <Text style={styles.detailRow}><Text style={styles.detailLabel}>Gain @1.575:</Text> {formatNumber(verificationState.summary.gain_1575)} dBi</Text>
                    <Text style={styles.detailRow}>
                      <Text style={styles.detailLabel}>S11 Bandwidth % (≤ {formatNumber(verificationState.summary?.bandwidth_thresholds?.s11_db, 0)} dB):</Text>{' '}
                      {formatNumber(verificationState.summary.s11_bandwidth_pct, 2)}%
                    </Text>
                    <Text style={styles.detailRow}>
                      <Text style={styles.detailLabel}>AR Bandwidth % (≤ {formatNumber(verificationState.summary?.bandwidth_thresholds?.ar_db, 0)} dB):</Text>{' '}
                      {formatNumber(verificationState.summary.ar_bandwidth_pct, 2)}%
                    </Text>
                  </>
                )}

                {verificationState.status === 'completed' && (
                  <>
                    {['chart_s11.png', 'chart_ar.png', 'chart_gain.png', 'chart_smith.png'].map((chartName) => {
                      const uri = chartUrl(chartName);
                      if (!uri) return null;
                      return (
                        <ZoomableChart
                          key={chartName}
                          title={chartName.replace('.png', '').replace('chart_', '').toUpperCase()}
                          uri={uri}
                        />
                      );
                    })}
                  </>
                )}
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { paddingTop: 44, paddingBottom: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8 },
  backButtonText: { color: '#fff', fontWeight: '700' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  refreshButton: { paddingHorizontal: 10, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8 },
  refreshButtonText: { color: '#fff', fontWeight: '700' },
  projectBanner: { backgroundColor: '#e0f2fe', borderBottomWidth: 1, borderColor: '#bae6fd', paddingHorizontal: 16, paddingVertical: 10 },
  projectBannerText: { color: '#075985', fontWeight: '600' },
  content: { flex: 1 },
  section: { margin: 12, backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 10 },

  profileBrowseCard: { borderWidth: 1, borderColor: '#dbeafe', borderRadius: 12, padding: 10, marginBottom: 12, backgroundColor: '#f8fbff' },
  profileBrowseHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  profileHeaderRight: { alignItems: 'flex-end' },
  profileBrowseTitle: { fontWeight: '800', color: '#0f172a', fontSize: 16 },
  profileBrowseMeta: { color: '#334155', fontSize: 12, marginTop: 2 },
  deleteProfileButton: { marginTop: 6, backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  deleteProfileButtonDisabled: { backgroundColor: '#e2e8f0', borderColor: '#cbd5e1' },
  deleteProfileButtonText: { color: '#b91c1c', fontWeight: '700', fontSize: 11 },
  profileBrowseInfoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  profileBrowseInfoText: { color: '#0f172a', fontSize: 12, fontWeight: '600', backgroundColor: '#e0f2fe', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  profileBrowseHint: { color: '#0369a1', marginTop: 8, fontWeight: '700', textAlign: 'right' },

  detailHeaderName: { fontSize: 18, fontWeight: '800', color: '#0f172a', marginBottom: 8 },
  validityBadge: { marginTop: 6, fontWeight: '700', fontSize: 12 },
  validBadge: { color: '#15803d' },
  invalidBadge: { color: '#b45309' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  centeredSmall: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  loadingText: { marginTop: 6, color: '#334155' },
  emptyText: { color: '#64748b' },

  detailInfoCard: { marginTop: 10, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 10, backgroundColor: '#ffffff' },
  detailRow: { color: '#0f172a', marginBottom: 6 },
  detailLabel: { fontWeight: '700' },

  optimalCard: { marginTop: 10, borderWidth: 1, borderColor: '#dbeafe', borderRadius: 10, padding: 10, backgroundColor: '#f8fbff' },
  optimalTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginBottom: 8 },

  metricIterationCard: { marginBottom: 10, borderRadius: 12, overflow: 'hidden' },
  metricIterationCardGradient: { padding: 14 },
  metricIterationTitle: { fontSize: 16, fontWeight: '800', color: '#374151', marginBottom: 10, textAlign: 'center' },
  metricIterationGrid: { flexDirection: 'row', justifyContent: 'space-around' },
  metricFrequencySection: { flex: 1, marginHorizontal: 4, backgroundColor: '#ffffff', padding: 10, borderRadius: 8, alignItems: 'center' },
  metricFrequencyHeader: { fontSize: 13, fontWeight: '800', color: '#1f2937', marginBottom: 8 },
  metricParameterRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 4 },
  metricParameterLabel: { fontSize: 11, color: '#6b7280', fontWeight: '600' },
  metricParameterValue: { fontSize: 11, color: '#1f2937', fontWeight: '700' },

  metricGroup: { marginTop: 6 },
  metricTitle: { fontWeight: '700', color: '#1e293b', marginBottom: 4 },
  variableGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  variableCard: { minWidth: 110, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 },
  variableName: { color: '#475569', fontSize: 11, fontWeight: '700' },
  variableValue: { color: '#0f172a', fontSize: 12, fontWeight: '800', marginTop: 2 },

  verifyButton: { marginTop: 10, backgroundColor: '#0369a1', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  verifyButtonDisabled: { backgroundColor: '#94a3b8' },
  verifyButtonText: { color: '#ffffff', fontWeight: '700' },

  controlRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  controlButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  runningButton: {
    backgroundColor: '#d1d5db',
    opacity: 0.85,
  },
  runningButtonText: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '700',
  },
  stopButton: {
    backgroundColor: '#ef4444',
  },
  stopButtonDisabled: {
    backgroundColor: '#9ca3af',
    opacity: 0.75,
  },
  controlButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },

  resultFilesCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    padding: 10,
  },

  miniMapWrap: { marginTop: 8, alignItems: 'center' },
  miniMapPlane: { borderWidth: 2, borderColor: '#2563eb', backgroundColor: '#dbeafe', position: 'relative', overflow: 'hidden' },
  guideVertical: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(15, 23, 42, 0.25)' },
  guideHorizontal: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(15, 23, 42, 0.25)' },
  antennaFootprint: {
    position: 'absolute',
    backgroundColor: '#fb923c',
    borderColor: '#ea580c',
    borderWidth: 2,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  antennaFootprintLabel: { color: '#ffffff', fontWeight: '800', fontSize: 11 },
  miniMapDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#dc2626', borderWidth: 1, borderColor: '#fff' },
  cornerLabelBottomLeft: { position: 'absolute', left: 4, bottom: 2, color: '#334155', fontSize: 11, fontWeight: '600' },
  cornerLabelBottomRight: { position: 'absolute', right: 4, bottom: 2, color: '#334155', fontSize: 11, fontWeight: '600' },
  cornerLabelTopLeft: { position: 'absolute', left: 4, top: 2, color: '#334155', fontSize: 11, fontWeight: '600' },
  cornerLabelTopRight: { position: 'absolute', right: 4, top: 2, color: '#334155', fontSize: 11, fontWeight: '600' },
  miniMapCaption: { color: '#334155', marginTop: 4, fontSize: 12 },

  chartWrap: { marginTop: 8, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 8, backgroundColor: '#ffffff' },
  chartImage: { width: '100%', height: 320, backgroundColor: '#f8fafc', borderRadius: 8 },
  zoomHint: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    backgroundColor: 'rgba(15,23,42,0.65)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  zoomHintText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 24,
  },
  modalImage: {
    width: width * 0.95,
    height: width * 0.95,
  },
  modalCloseBtn: {
    position: 'absolute',
    top: 48,
    right: 18,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 14 },
});
