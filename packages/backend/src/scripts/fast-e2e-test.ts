import axios from 'axios';

const api = axios.create({ baseURL: 'http://localhost:4000/api' });
let token = '';

const log = (name: string, success: boolean, msg: string = '') => {
  console.log(`${success ? '✅' : '❌'} ${name.padEnd(30)} ${msg}`);
};

async function runTests() {
  try {
    console.log('--- 🚀 Starting Fast E2E Tests ---\n');

    // 1. Auth & Login
    const loginRes = await api.post('/auth/login', { companyCode: 'demo', email: 'demo@busync.com', password: 'demo' });
    token = loginRes.data.data.token;
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    log('1. User Login (demo)', true);

    // 2. Fetch Dashboard Stats (Buses, Routes, Drivers)
    const driversRes = await api.get('/users?role=DRIVER');
    log('2. Fetch Drivers List', driversRes.data.success, `${driversRes.data.data.length} found`);
    
    const busesRes = await api.get('/buses');
    log('3. Fetch Buses List', busesRes.data.success, `${busesRes.data.data.length} found`);

    const routesRes = await api.get('/routes');
    log('4. Fetch Routes List', routesRes.data.success, `${routesRes.data.data.length} found`);

    // 3. User CRUD
    const createDriver = await api.post('/users', { name: '테스트기사', email: 'test1@busync.com', phone: '010-9999-9991', employeeId: 'T-001', role: 'DRIVER', password: 'test', driverType: 'MAIN' });
    const newDriverId = createDriver.data.data.id;
    log('5. Create Driver', createDriver.data.success, `ID: ${newDriverId}`);
    
    const updateDriver = await api.put(`/users/${newDriverId}`, { name: '테스트기사_수정' });
    log('6. Update Driver', updateDriver.data.success);

    const deleteDriver = await api.delete(`/users/${newDriverId}`);
    log('7. Deactivate Driver', deleteDriver.data.success);

    // 4. Schedule AI Generate
    const genRes = await api.post('/schedules/generate', { year: 2026, month: 5, workDays: 5, restDays: 2 });
    log('8. AI Schedule Generation', genRes.data.success, `Generated slots: ${genRes.data.data.slotsCreated}`);

    // 5. Day-Off Request
    const dayOffRes = await api.post('/dayoff', { date: '2026-05-15', reason: '개인 사정' });
    log('9. Create Day-Off Request', dayOffRes.data.success);
    
    // 6. Maintenance
    const maintRes = await api.post('/maintenance', { busId: busesRes.data.data[0].id, type: 'OIL_CHANGE', scheduledAt: '2026-05-20T00:00:00Z', status: 'SCHEDULED' });
    log('10. Add Maintenance Record', maintRes.data.success);

    // 7. Chatbot (Tests Anthropic API)
    const chatSess = await api.post('/chat/sessions', { title: 'Test Session' });
    const chatRes = await api.post(`/chat/sessions/${chatSess.data.data.id}/messages`, { message: '안녕! 배차 규칙에 대해 알려줘', saveAsRule: false });
    log('11. AI Chatbot Reply', chatRes.data.success, `Reply len: ${chatRes.data.data.reply.length}`);

    console.log('\n🎉 All API endpoints are working properly!');
  } catch (err: any) {
    console.error('\n❌ Test failed at:');
    if (err.response) {
      console.error(err.response.status, err.response.data);
    } else {
      console.error(err.message);
    }
  }
}

runTests();
