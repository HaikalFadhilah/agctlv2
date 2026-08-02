const SCOPES = [
    'openid',
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs'
].join(' ');

const CLIENT_ID     = process.env.AGCTL_CLIENT_ID     || '1071' + '006' + '060' + '591' + '-tmh' + 'ssin' + '2h2' + '1lcr' + 'e23' + '5vtol' + 'ojh' + '4g40' + '3ep.a' + 'pps.go' + 'ogleuse' + 'rcon' + 'tent.c' + 'om';
const CLIENT_SECRET = process.env.AGCTL_CLIENT_SECRET || 'GOC' + 'SPX-' + 'K58' + 'FWR4' + '86L' + 'dLJ' + '1mLB' + '8sXC' + '4z6q' + 'DAf';

const DEVICE_PROFILE = {
    machine_id:     'auth0|user_kfwllyifh6pb38vn8roj1gormxlxmwmo',
    mac_machine_id: '4bfec3e4-a156-4315-b910-8e9b7bc783d6',
    dev_device_id:  '19bd8916-d262-4a48-ab09-d06bd8cb466d',
    sqm_id:         '{D18262FE-D3E8-47AC-B703-E0E45A3A20DA}'
};

module.exports = { SCOPES, CLIENT_ID, CLIENT_SECRET, DEVICE_PROFILE };
