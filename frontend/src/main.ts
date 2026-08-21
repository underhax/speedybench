import './style.css';
import { setupSpeedtest } from './speedtest.ts';
import { setupDetailsModal } from './ui/details.ts';
import { setupHeader } from './ui/header.ts';
import { setupSettingsModal } from './ui/settings.ts';

setupHeader();
setupSettingsModal();
const { getDlDetails, getUlDetails } = setupSpeedtest();
setupDetailsModal(getDlDetails, getUlDetails);
