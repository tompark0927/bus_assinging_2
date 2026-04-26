import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { MessageSquare, Send, Plus, Search, ArrowLeft } from 'lucide-react';
import { dmApi } from '../services/api';
import { useAuthStore } from '../store/authStore';

interface Conversation {
  partner: { id: number; name: string; role: string; employeeId: string };
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
}

interface Message {
  id: number;
  senderId: number;
  content: string;
  createdAt: string;
  sender: { id: number; name: string };
}

interface CompanyUser {
  id: number;
  name: string;
  role: string;
  employeeId: string;
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: '대표',
  ADMIN: '관리자',
  MANAGER: '관리',
  DRIVER: '기사',
};

export default function MessagesPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [selectedPartner, setSelectedPartner] = useState<{ id: number; name: string } | null>(null);
  const [messageText, setMessageText] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [searchText, setSearchText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Conversations
  const { data: conversations = [] } = useQuery({
    queryKey: ['dm-conversations'],
    queryFn: () => dmApi.conversations().then(r => r.data.data),
    refetchInterval: 10000,
  });

  // Messages for selected partner
  const { data: messages = [] } = useQuery({
    queryKey: ['dm-messages', selectedPartner?.id],
    queryFn: () => dmApi.messages(selectedPartner!.id).then(r => r.data.data),
    enabled: !!selectedPartner,
    refetchInterval: 5000,
  });

  // Company users for new chat
  const { data: companyUsers = [] } = useQuery({
    queryKey: ['dm-users'],
    queryFn: () => dmApi.users().then(r => r.data.data),
    enabled: showNewChat,
  });

  // Send message
  const sendMutation = useMutation({
    mutationFn: ({ receiverId, content }: { receiverId: number; content: string }) =>
      dmApi.send(receiverId, content),
    onSuccess: () => {
      setMessageText('');
      queryClient.invalidateQueries({ queryKey: ['dm-messages', selectedPartner?.id] });
      queryClient.invalidateQueries({ queryKey: ['dm-conversations'] });
    },
    onError: () => toast.error('메시지 전송에 실패했습니다.'),
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!messageText.trim() || !selectedPartner) return;
    sendMutation.mutate({ receiverId: selectedPartner.id, content: messageText.trim() });
  };

  const handleSelectUser = (u: CompanyUser) => {
    setSelectedPartner({ id: u.id, name: u.name });
    setShowNewChat(false);
    setSearchText('');
  };

  const filteredUsers = companyUsers.filter((u: CompanyUser) =>
    u.name.includes(searchText) || u.employeeId.includes(searchText)
  );

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <MessageSquare className="text-blue-600" size={28} />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">메시지</h1>
      </div>

      <div className="flex bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden" style={{ height: 'calc(100vh - 180px)' }}>
        {/* Left: Conversation List */}
        <div className="w-80 border-r border-gray-100 dark:border-gray-700 flex flex-col">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700">
            <button
              onClick={() => setShowNewChat(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl font-semibold text-base hover:bg-blue-700 transition-colors"
              style={{ minHeight: 48 }}
            >
              <Plus size={20} />
              새 메시지
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <MessageSquare size={40} className="mx-auto mb-3 opacity-40" />
                <p className="text-base">대화가 없습니다.</p>
                <p className="text-sm mt-1">새 메시지를 보내보세요!</p>
              </div>
            ) : (
              conversations.map((conv: Conversation) => (
                <button
                  key={conv.partner.id}
                  onClick={() => setSelectedPartner({ id: conv.partner.id, name: conv.partner.name })}
                  className={`w-full text-left px-4 py-4 border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                    selectedPartner?.id === conv.partner.id ? 'bg-blue-50 dark:bg-blue-900/30' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-base flex-shrink-0">
                      {conv.partner.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-gray-900 dark:text-gray-100 text-base">{conv.partner.name}</span>
                        <span className="text-xs text-gray-400">
                          {format(new Date(conv.lastMessageAt), 'MM.dd', { locale: ko })}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-sm text-gray-500 dark:text-gray-400 truncate pr-2">{conv.lastMessage}</p>
                        {conv.unreadCount > 0 && (
                          <span className="bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                            {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: Message Thread */}
        <div className="flex-1 flex flex-col">
          {!selectedPartner ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <MessageSquare size={56} className="mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium">대화를 선택하세요</p>
                <p className="text-sm mt-1">왼쪽에서 대화를 선택하거나 새 메시지를 보내세요.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
                <button
                  onClick={() => setSelectedPartner(null)}
                  className="lg:hidden p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  <ArrowLeft size={20} />
                </button>
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-base">
                  {selectedPartner.name.charAt(0)}
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-gray-100 text-lg">{selectedPartner.name}</h3>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                {messages.map((msg: Message) => {
                  const isMine = msg.senderId === user?.id;
                  return (
                    <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[70%] ${isMine ? 'order-2' : ''}`}>
                        <div
                          className={`px-4 py-3 rounded-2xl text-base ${
                            isMine
                              ? 'bg-blue-600 text-white rounded-br-md'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-bl-md'
                          }`}
                        >
                          {msg.content}
                        </div>
                        <p className={`text-xs text-gray-400 mt-1 ${isMine ? 'text-right' : ''}`}>
                          {format(new Date(msg.createdAt), 'HH:mm', { locale: ko })}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700">
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={messageText}
                    onChange={e => setMessageText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                    placeholder="메시지를 입력하세요..."
                    className="flex-1 px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    style={{ minHeight: 48 }}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!messageText.trim() || sendMutation.isPending}
                    className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 transition-colors flex items-center gap-2"
                    style={{ minHeight: 48 }}
                  >
                    <Send size={18} />
                    전송
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* New Chat Modal */}
      {showNewChat && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="p-5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">새 메시지</h2>
              <button
                onClick={() => { setShowNewChat(false); setSearchText(''); }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl px-2"
              >
                ✕
              </button>
            </div>

            <div className="p-4 border-b border-gray-100 dark:border-gray-700">
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  placeholder="이름 또는 사번으로 검색"
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  style={{ minHeight: 48 }}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {filteredUsers.map((u: CompanyUser) => (
                <button
                  key={u.id}
                  onClick={() => handleSelectUser(u)}
                  className="w-full text-left px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-50 dark:border-gray-700 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold">
                      {u.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-gray-100 text-base">{u.name}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {ROLE_LABELS[u.role] || u.role} · {u.employeeId}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
              {filteredUsers.length === 0 && (
                <p className="text-center py-10 text-gray-400 text-base">검색 결과가 없습니다.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
