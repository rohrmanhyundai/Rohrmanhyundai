import React, { useState, useEffect, useRef, useCallback } from 'react';
import { loadChatMessages, saveChatMessages } from '../utils/github';

const POLL_MS = 5000;
const TYPING_PAUSE_MS = 2000;

export default function Chat({ currentUser, hasChatAccess }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);
  const typingTimerRef = useRef(null);
  const isTypingRef = useRef(false);
  const pollRef = useRef(null);

  const fetchMessages = useCallback(async () => {
    try {
      const msgs = await loadChatMessages();
      setMessages(msgs);
    } catch {}
  }, []);

  // Start/stop polling based on typing state
  const startPoll = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(() => {
      if (!isTypingRef.current) fetchMessages();
    }, POLL_MS);
  }, [fetchMessages]);

  useEffect(() => {
    fetchMessages();
    startPoll();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchMessages, startPoll]);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleTextChange(e) {
    setText(e.target.value);
    isTypingRef.current = true;
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      isTypingRef.current = false;
      fetchMessages(); // refresh once typing stops
    }, TYPING_PAUSE_MS);
  }

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError('');
    try {
      // Fetch latest first to avoid overwriting concurrent messages
      const latest = await loadChatMessages();
      const newMsg = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        username: currentUser,
        text: trimmed,
        timestamp: Date.now(),
      };
      const saved = await saveChatMessages([...latest, newMsg]);
      setMessages(saved);
      setText('');
      isTypingRef.current = false;
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
      ' ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // Group consecutive messages from same user
  const grouped = messages.reduce((acc, msg, i) => {
    const prev = messages[i - 1];
    const isFirst = !prev || prev.username !== msg.username || msg.timestamp - prev.timestamp > 5 * 60 * 1000;
    acc.push({ ...msg, isFirst });
    return acc;
  }, []);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 16, overflow: 'hidden', height: '100%',
    }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', flexShrink: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: '#e2e8f0' }}>💬 Team Chat</div>
        <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>Advisor group — messages expire after 30 days</div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#334155', fontSize: 13, marginTop: 40 }}>No messages yet. Say hello!</div>
        )}
        {grouped.map(msg => {
          const isMe = msg.username.toUpperCase() === currentUser.toUpperCase();
          return (
            <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', marginTop: msg.isFirst ? 10 : 2 }}>
              {msg.isFirst && (
                <div style={{ fontSize: 10, color: '#475569', marginBottom: 3, paddingLeft: isMe ? 0 : 4, paddingRight: isMe ? 4 : 0 }}>
                  {isMe ? fmtTime(msg.timestamp) : `${msg.username} · ${fmtTime(msg.timestamp)}`}
                </div>
              )}
              <div style={{
                maxWidth: '78%', padding: '7px 12px', borderRadius: msg.isFirst ? (isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px') : (isMe ? '14px 4px 4px 14px' : '4px 14px 14px 14px'),
                background: isMe ? 'rgba(61,214,195,0.22)' : 'rgba(255,255,255,0.07)',
                border: isMe ? '1px solid rgba(61,214,195,0.3)' : '1px solid rgba(255,255,255,0.08)',
                color: isMe ? '#a7f3d0' : '#cbd5e1',
                fontSize: 13, lineHeight: 1.45, wordBreak: 'break-word',
              }}>
                {msg.text}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {hasChatAccess ? (
        <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
          {error && <div style={{ fontSize: 11, color: '#f87171', marginBottom: 6 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <textarea
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              placeholder="Type a message… (Enter to send)"
              rows={2}
              style={{
                flex: 1, resize: 'none', background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
                color: '#e2e8f0', padding: '8px 10px', fontSize: 13, outline: 'none',
                fontFamily: 'inherit', lineHeight: 1.4,
              }}
            />
            <button
              onClick={handleSend}
              disabled={sending || !text.trim()}
              style={{
                background: sending || !text.trim() ? 'rgba(61,214,195,0.1)' : 'rgba(61,214,195,0.25)',
                border: '1px solid rgba(61,214,195,0.4)', borderRadius: 10,
                color: '#6ee7b7', fontWeight: 800, fontSize: 13,
                padding: '0 14px', cursor: sending || !text.trim() ? 'not-allowed' : 'pointer',
                opacity: sending || !text.trim() ? 0.5 : 1, alignSelf: 'stretch',
              }}
            >
              {sending ? '⏳' : '➤'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 12, color: '#334155', textAlign: 'center' }}>
          Chat access not enabled for your account
        </div>
      )}
    </div>
  );
}
