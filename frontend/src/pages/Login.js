// src/pages/Login.js
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { styled } from '@mui/material/styles';
import {
  Box,
  Button,
  CssBaseline,
  Divider,
  FormLabel,
  FormControl,
  Link,
  TextField,
  Typography,
  Stack,
  Card as MuiCard
} from '@mui/material';
import { GoogleIcon, FacebookIcon } from './../components/CustomIcons';
import AppTheme from '../theme/AppTheme';
import { useAuth } from '../context/AuthContext';
import BrickstoreLogo from '../components/BrickstoreLogo';


const Card = styled(MuiCard)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignSelf: 'center',
  width: '100%',
  padding: theme.spacing(4),
  gap: theme.spacing(2),
  margin: 'auto',
  [theme.breakpoints.up('sm')]: {
    maxWidth: '450px',
  },
  boxShadow:
    'hsla(220, 30%, 5%, 0.05) 0px 5px 15px 0px, hsla(220, 25%, 10%, 0.05) 0px 15px 35px -5px',
  ...theme.applyStyles('dark', {
    boxShadow:
      'hsla(220, 30%, 5%, 0.5) 0px 5px 15px 0px, hsla(220, 25%, 10%, 0.08) 0px 15px 35px -5px',
  }),
}));

const SignInContainer = styled(Stack)(({ theme }) => ({
  height: 'calc((1 - var(--template-frame-height, 0)) * 100dvh)',
  minHeight: '100%',
  padding: theme.spacing(2),
  [theme.breakpoints.up('sm')]: {
    padding: theme.spacing(4),
  },
  '&::before': {
    content: '""',
    display: 'block',
    position: 'absolute',
    zIndex: -1,
    inset: 0,
    backgroundImage:
      'radial-gradient(ellipse at 50% 50%, hsl(210, 100%, 97%), hsl(0, 0%, 100%))',
    backgroundRepeat: 'no-repeat',
    ...theme.applyStyles('dark', {
      backgroundImage:
        'radial-gradient(at 50% 50%, hsla(210, 100%, 16%, 0.5), hsl(220, 30%, 5%))',
    }),
  },
}));

// Demo quick-login buttons. Theme-aware and clearly visible in BOTH modes —
// the dark styles live inside applyStyles('dark') because the theme's button
// overrides use that higher-specificity selector and would otherwise win.
const quickLoginSx = (theme) => ({
  textTransform: 'none',
  fontSize: '0.75rem',
  py: 0.5,
  px: 1.5,
  color: theme.palette.text.primary,
  backgroundColor: theme.palette.grey[100],
  borderColor: theme.palette.grey[300],
  '&:hover': {
    backgroundColor: theme.palette.grey[200],
    borderColor: theme.palette.grey[400],
  },
  ...theme.applyStyles('dark', {
    color: '#fff',
    backgroundColor: theme.palette.grey[700],
    borderColor: theme.palette.grey[600],
    '&:hover': {
      backgroundColor: theme.palette.grey[600],
      borderColor: theme.palette.grey[500],
    },
  }),
});

export default function Login(props) {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [emailError, setEmailError] = React.useState(false);
  const [emailErrorMessage, setEmailErrorMessage] = React.useState('');
  const [passwordError, setPasswordError] = React.useState(false);
  const [passwordErrorMessage, setPasswordErrorMessage] = React.useState('');

  const { login } = useAuth();
  const navigate = useNavigate();

  const validateInputs = () => {
    let isValid = true;

    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      setEmailError(true);
      setEmailErrorMessage('Please enter a valid email address.');
      isValid = false;
    } else {
      setEmailError(false);
      setEmailErrorMessage('');
    }

    if (!password || password.length < 6) {
      setPasswordError(true);
      setPasswordErrorMessage('Password must be at least 6 characters long.');
      isValid = false;
    } else {
      setPasswordError(false);
      setPasswordErrorMessage('');
    }

    return isValid;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!validateInputs()) return;

    const ok = await login(email, password);
    if (ok) {
      navigate('/home');
    } else {
      alert("Login failed");
    }
  };

  const handleQuickLogin = (e, p) => {
    setEmail(e);
    setPassword(p);
    setEmailError(false);
    setEmailErrorMessage('');
    setPasswordError(false);
    setPasswordErrorMessage('');
  };

  return (
    <AppTheme {...props}>
      <CssBaseline enableColorScheme />
      <SignInContainer direction="column" justifyContent="space-between">
        <Card variant="outlined">
            <Box
            sx={{
              display: 'flex',
              mt: 'calc(var(--template-frame-height, 0px) + 4px)',
              p: 1.5,
              justifyContent: 'center'
            }}
          >
            <BrickstoreLogo
              alt="Brickstore"
              sx={{ width: '180px', height: '60px' }}
            />
          </Box>
          <Typography
            component="h1"
            variant="h4"
            sx={{ width: '100%', fontSize: 'clamp(2rem, 10vw, 2.15rem)' }}
          >
            Sign in
          </Typography>
          
          <Box
            component="form"
            onSubmit={handleSubmit}
            noValidate
            sx={{
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              gap: 2,
            }}
          >
            <FormControl>
              <FormLabel htmlFor="email">Email</FormLabel>
              <TextField
                error={emailError}
                helperText={emailErrorMessage}
                id="email"
                type="email"
                name="email"
                placeholder="your@email.com"
                autoComplete="email"
                autoFocus
                required
                fullWidth
                variant="outlined"
                color={emailError ? 'error' : 'primary'}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FormControl>
            <FormControl>
              <FormLabel htmlFor="password">Password</FormLabel>
              <TextField
                error={passwordError}
                helperText={passwordErrorMessage}
                name="password"
                placeholder="••••••"
                type="password"
                id="password"
                autoComplete="current-password"
                required
                fullWidth
                variant="outlined"
                color={passwordError ? 'error' : 'primary'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormControl>
            
            {/* Demo User Quick Login Buttons */}
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => handleQuickLogin('carl@apex.com', 'Demo1234!')}
                sx={quickLoginSx}
              >
                👨‍💼 User 1 - Carl
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => handleQuickLogin('robyn@synergy.com', 'Demo1234!')}
                sx={quickLoginSx}
              >
                👩‍💻 User 2 - Robyn
              </Button>
            </Box>
            
            <Button
              type="submit"
              fullWidth
              variant="contained"
            >
              Sign in
            </Button>
            
            <Link
              component="button"
              type="button"
              onClick={() => {}}
              variant="body2"
              sx={{ alignSelf: 'center' }}
            >
              Forgot your password?
            </Link>
          </Box>
          <Divider>or</Divider>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Button
              fullWidth
              variant="outlined"
              onClick={() => {}}
              startIcon={<GoogleIcon />}
            >
              Sign in with Google
            </Button>
            <Button
              fullWidth
              variant="outlined"
              onClick={() => {}}
              startIcon={<FacebookIcon />}
            >
              Sign in with Facebook
            </Button>
            <Typography sx={{ textAlign: 'center' }}>
              Don&apos;t have an account?{' '}
              <Link
                component="button"
                onClick={() => {}}
                variant="body2"
                sx={{ alignSelf: 'center' }}
              >
                Sign up
              </Link>
            </Typography>
          </Box>
        </Card>
      </SignInContainer>
    </AppTheme>
  );
}