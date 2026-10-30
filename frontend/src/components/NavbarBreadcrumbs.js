import * as React from 'react';
import { styled } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import Breadcrumbs, { breadcrumbsClasses } from '@mui/material/Breadcrumbs';
import NavigateNextRoundedIcon from '@mui/icons-material/NavigateNextRounded';
import { useLocation } from 'react-router-dom';

const StyledBreadcrumbs = styled(Breadcrumbs)(({ theme }) => ({
  margin: theme.spacing(1, 0),
  [`& .${breadcrumbsClasses.separator}`]: {
    color: (theme.vars || theme).palette.action.disabled,
    margin: 1,
  },
  [`& .${breadcrumbsClasses.ol}`]: {
    alignItems: 'center',
  },
}));



export default function NavbarBreadcrumbs() {

  function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }

  const location = useLocation();
  // Use only the top-level segment so deep links like /genie/c/2 still read
  // "Genie" rather than the raw "Genie/c/2".
  const segment = location.pathname.split('/').filter(Boolean)[0] || '';
  const current_location = capitalizeFirstLetter(segment);
  return (

    <StyledBreadcrumbs
      aria-label="breadcrumb"
      separator={<NavigateNextRoundedIcon fontSize="small" />}
    >
      <Typography variant="body1">
        BrickStore
      </Typography>
      <Typography variant="body1" sx={{ color: 'text.primary', fontWeight: 600 }}>{current_location}</Typography>
    </StyledBreadcrumbs>

  );
}