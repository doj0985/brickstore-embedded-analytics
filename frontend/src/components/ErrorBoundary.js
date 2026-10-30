import React from 'react';
import { Alert, AlertTitle, Box, Button } from '@mui/material';

export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Wire to Sentry / your error service of choice in production.
    console.error('Unhandled render error:', error, info);
  }

  reset = () => {
    this.setState({ error: null });
    window.location.href = '/';
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Box sx={{ p: 4, maxWidth: 600, mx: 'auto', mt: 8 }}>
        <Alert severity="error">
          <AlertTitle>Something went wrong</AlertTitle>
          The page hit an unexpected error. Try reloading.
        </Alert>
        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <Button variant="contained" onClick={this.reset}>Go home</Button>
        </Box>
      </Box>
    );
  }
}
