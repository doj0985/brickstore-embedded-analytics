import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from "axios";
import { alpha, useColorScheme } from '@mui/material/styles';
import { Alert, CssBaseline, Box, Stack } from '@mui/material';
import AppNavbar from '../components/AppNavbar';
import Header from '../components/Header';
import SideMenu from '../components/SideMenu';
import AppTheme from '../theme/AppTheme';
import { DatabricksDashboard } from '@databricks/aibi-client';

// Maps the app's MUI color mode (driven by the top-right toggle, via
// useColorScheme) to the SDK's colorScheme option. 'system' (or an
// not-yet-resolved mode) lets the embedded dashboard follow the OS preference,
// matching how MUI resolves "System".
function toSdkColorScheme(mode) {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  return 'light dark';
}

function DashboardsContent() {
  const [dashboardConfig, setDashboardConfig] = useState(null);
  const [initialToken, setInitialToken] = useState(null);
  const [error, setError] = useState(null);
  const containerRef = useRef(null);
  // Holds the live DatabricksDashboard instance so we can call .navigate() etc.
  const dashboardRef = useRef(null);

  // Tie the embedded dashboard's color scheme to the existing top-right toggle.
  const { mode } = useColorScheme();
  const colorScheme = toSdkColorScheme(mode);

  // Returns a fresh token string. The SDK calls this before the current token
  // expires to refresh the iframe without re-mounting.
  const fetchToken = useCallback(async () => {
    const response = await axios.post('/api/dashboard/get_token');
    return response.data;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [configRes, token] = await Promise.all([
          axios.post('/api/dashboard/config'),
          fetchToken(),
        ]);
        setDashboardConfig(configRes.data);
        setInitialToken(token);
      } catch (err) {
        // 401s are already handled globally by the axios interceptor; surface
        // anything else (500 from the token endpoint, network error, etc.) so
        // the user sees a real message instead of a blank page.
        if (err.response?.status !== 401) {
          console.error('Failed to load dashboard:', err);
          setError(err.response?.data?.message || err.message || 'Failed to load dashboard');
        }
      }
    })();
  }, [fetchToken]);

  useEffect(() => {
    if (!dashboardConfig || !initialToken || !containerRef.current) return;

    const dashboard = new DatabricksDashboard({
      instanceUrl: dashboardConfig.instance_url,
      workspaceId: dashboardConfig.workspace_id,
      dashboardId: dashboardConfig.dashboard_id,
      token: initialToken,
      container: containerRef.current,
      getNewToken: fetchToken,
      colorScheme,
      config: {
        version: 1,
        hideDatabricksLogo: true,
      },
    });
    dashboard.initialize();
    dashboardRef.current = dashboard;

    return () => {
      dashboard.destroy();
      dashboardRef.current = null;
    };
    // colorScheme is a constructor option, so toggling light/dark in the navbar
    // re-initializes the embedded dashboard with the new scheme.
  }, [dashboardConfig, initialToken, fetchToken, colorScheme]);

  return (
    <Box sx={{ display: 'flex' }}>
      <SideMenu />
      <AppNavbar />
      <Box
        component="main"
        sx={(theme) => ({
          flexGrow: 1,
          backgroundColor: theme.vars
            ? `rgba(${theme.vars.palette.background.defaultChannel} / 1)`
            : alpha(theme.palette.background.default, 1),
          overflow: 'auto',
        })}
      >
        <Stack
          spacing={2}
          sx={{
            alignItems: 'center',
            mx: 3,
            pb: 5,
            mt: { xs: 8, md: 0 },
          }}
        >
          <Header />
          <>Dashboards 📊</>
        </Stack>
        <Box
          sx={{
            alignItems: 'center',
            mx: 3,
            pb: 5,
            mt: { xs: 8, md: 0 },
          }}
        >
          {error ? (
            <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
          ) : (
            <Box
              ref={containerRef}
              sx={{
                width: '100%',
                height: '100vh',
                border: 'none',
                '& > iframe': {
                  width: '100%',
                  height: '100%',
                  border: 'none',
                },
              }}
            />
          )}
        </Box>
      </Box>
    </Box>
  );
}

export default function Dashboards() {
  // AppTheme provides the MUI color-scheme context that DashboardsContent reads
  // via useColorScheme, so the dashboard's color scheme must live inside it.
  return (
    <AppTheme>
      <CssBaseline enableColorScheme />
      <DashboardsContent />
    </AppTheme>
  );
}
