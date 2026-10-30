import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { styled } from '@mui/material/styles';
import Avatar from '@mui/material/Avatar';
import MuiDrawer, { drawerClasses } from '@mui/material/Drawer';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import SelectContent from './SelectContent';
import MenuContent from './MenuContent';
import CardAlert from './CardAlert';
import OptionsMenu from './OptionsMenu';
import {useAuth} from '../context/AuthContext'
import BrickstoreLogo from './BrickstoreLogo';
import { useLocation } from 'react-router-dom';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import {
  IconButton, Box, Stack, Button
} from "@mui/material";

const drawerWidth = 240;

const Drawer = styled(MuiDrawer)({
  width: drawerWidth,
  flexShrink: 0,
  boxSizing: 'border-box',
  mt: 10,
  [`& .${drawerClasses.paper}`]: {
    width: drawerWidth,
    boxSizing: 'border-box',
  },
});

export default function SideMenu() {

  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <Drawer
      variant="permanent"
      sx={{
        display: { xs: 'none', md: 'block' },
        [`& .${drawerClasses.paper}`]: {
          backgroundColor: 'background.paper',
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          mt: 'calc(var(--template-frame-height, 0px) + 4px)',
          p: 1.5,
          justifyContent: 'center'
        }}
      >
        <IconButton sx={{
                    border: 'none',
                        '&:hover': {
      backgroundColor: 'transparent',
    },
                  }}>        <BrickstoreLogo
            alt="Brickstore"
            onClick={() => navigate('/Home')}
            sx={{ width: '180px', height: '59px', cursor: 'pointer' }}
          /></IconButton>

      </Box>
      <Divider />
      {location.pathname === "/Dashboards" &&
        <Box
        sx={{
          display: 'flex',
          mt: 'calc(var(--template-frame-height, 0px) + 4px)',
          p: 1.5,
        }}>
        <SelectContent /> 
      </Box>}
      <MenuContent />
      
      
      <CardAlert />
      {user ?
      <Stack
        sx={{
          borderTop: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Stack
          direction="row"
          sx={{
            p: 2,
            gap: 1,
            alignItems: 'center',
          }}
        >
          <Avatar
            sizes="small"
            alt={user.first_name}
            sx={{ width: 36, height: 36, bgcolor: 'transparent', fontSize: 24 }}
          >{{ apex: '👨‍💼', synergy: '👨‍💻' }[user.company?.toLowerCase()] || user.first_name[0]}</Avatar>
          <Box sx={{ mr: 'auto', maxWidth: 'calc(100% - 80px)' }}>
            <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: '16px' }}>
            {user.first_name} {user.last_name}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            
                  {user.email}
            </Typography>
          </Box>
          <OptionsMenu />
        </Stack>
        <Box sx={{ px: 2, pb: 2 }}>
          <Button 
            variant="outlined" 
            onClick={handleLogout} 
            fullWidth 
            startIcon={<LogoutRoundedIcon />}
            size="small"
          >
            Logout
          </Button>
        </Box>
      </Stack>
      :null}
    </Drawer>
  );
}