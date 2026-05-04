import React, { useState, useEffect, useRef, useCallback } from 'react';
import { loadTechChatMessages, saveTechChatMessages } from '../utils/github';
import { getPusher, triggerEvent, TECH_CHANNEL, NEW_MSG_EVENT } from '../utils/pusher';

const TYPING_PAUSE_MS = 2000;

export default function TechChat({ currentUser, currentRole, hasChatAccess }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const bottomRef = useRef(null);
  const typingTimerRef = useRef(null);
  const isTypingRef = useRef(false);
  const textareaRef = useRef(null);

  const canDelete = currentRole === 'admin' || (currentRole || '').includes('manager');

  const EMOJIS = [
    '😀','😂','😍','🥰','😎','🤔','😅','🙏','👍','👎','🔥','💯',
    '❤️','✅','⚠️','🚗','🔧','📋','📞','💬','🎉','👏','💪','🤝',
    '😊','😬','🤦','🙌','👀','💀','😤','🥳','😴','🤯','😭','😱',
  ];

  const fetchMessages = useCallback(async () => {
    try {
      const msgs = await loadTechChatMessages();
      setMessages(msgs);
    } catch {}
  }, []);

  useEffect(() => {
    fetchMessages();
    const channel = getPusher().subscribe(TECH_CHANNEL);
    channel.bind(NEW_MSG_EVENT, () => {
      if (!isTypingRef.current) fetchMessages();
    });
    return () => { getPusher().unsubscribe(TECH_CHANNEL); };
  }, [fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleTextChange(e) {
    setText(e.target.value);
    isTypingRef.current = true;
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      isTypingRef.current = false;
      fetchMessages();
    }, TYPING_PAUSE_MS);
  }

  async function handleSend() {
    const trimmed = text.trim().replace(/\n+/g, ' ');
    if (!trimmed || sending) return;
    setSending(true);
    setError('');
    try {
      const latest = await loadTechChatMessages();
      const newMsg = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        username: currentUser,
        text: trimmed,
        timestamp: Date.now(),
        ...(replyTo ? { replyTo: { id: replyTo.id, username: replyTo.username, text: replyTo.text.slice(0, 140) } } : {}),
      };
      const saved = await saveTechChatMessages([...latest, newMsg]);
      setMessages(saved);
      setText('');
      setReplyTo(null);
      isTypingRef.current = false;
      triggerEvent(TECH_CHANNEL, NEW_MSG_EVENT);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function insertEmoji(emoji) {
    const el = textareaRef.current;
    if (!el) { setText(t => t + emoji); return; }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const newText = text.slice(0, start) + emoji + text.slice(end);
    setText(newText);
    setTimeout(() => { el.selectionStart = el.selectionEnd = start + emoji.length; el.focus(); }, 0);
  }

  async function toggleReaction(msgId, emoji) {
    setError('');
    try {
      const latest = await loadTechChatMessages();
      const updated = latest.map(m => {
        if (m.id !== msgId) return m;
        const reactions = { ...(m.reactions || {}) };
        const list = reactions[emoji] || [];
        const me = currentUser.toUpperCase();
        const has = list.map(u => u.toUpperCase()).includes(me);
        const next = has ? list.filter(u => u.toUpperCase() !== me) : [...list, currentUser];
        if (next.length === 0) delete reactions[emoji];
        else reactions[emoji] = next;
        return { ...m, reactions };
      });
      const saved = await saveTechChatMessages(updated);
      setMessages(saved);
      triggerEvent(TECH_CHANNEL, NEW_MSG_EVENT);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    setDeleting(id);
    setError('');
    try {
      const latest = await loadTechChatMessages();
      const updated = await saveTechChatMessages(latest.filter(m => m.id !== id));
      setMessages(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(null);
    }
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
      ' ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

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
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', flexShrink: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: '#e2e8f0' }}>💬 Tech Chat</div>
        <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>Tech group — messages expire after 30 days</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#334155', fontSize: 13, marginTop: 40 }}>No messages yet. Say hello!</div>
        )}
        {grouped.map(msg => {
          const isMe = msg.username.toUpperCase() === currentUser.toUpperCase();
          return (
            <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', marginTop: msg.isFirst ? 10 : 2, width: '100%' }}>
              {msg.isFirst && (
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 3, paddingLeft: isMe ? 0 : 4, paddingRight: isMe ? 4 : 0, letterSpacing: 0.3 }}>
                  <span style={{ color: '#e2e8f0', fontWeight: 800 }}>{msg.username}</span>
                  {` · ${fmtTime(msg.timestamp)}`}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexDirection: isMe ? 'row-reverse' : 'row', maxWidth: '100%' }}>
                <div
                  onClick={() => hasChatAccess && setReplyTo({ id: msg.id, username: msg.username, text: msg.text })}
                  title="Click to reply"
                  style={{
                    maxWidth: 220, padding: '7px 12px',
                    borderRadius: msg.isFirst ? (isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px') : (isMe ? '14px 4px 4px 14px' : '4px 14px 14px 14px'),
                    background: isMe ? 'rgba(251,146,60,0.2)' : 'rgba(255,255,255,0.07)',
                    border: isMe ? '1px solid rgba(251,146,60,0.35)' : '1px solid rgba(255,255,255,0.08)',
                    color: isMe ? '#fed7aa' : '#cbd5e1',
                    fontSize: 13, lineHeight: 1.45, wordBreak: 'break-word', whiteSpace: 'normal',
                    cursor: hasChatAccess ? 'pointer' : 'default',
                  }}>
                  {msg.replyTo && (
                    <div style={{
                      borderLeft: '3px solid rgba(251,191,36,0.6)', paddingLeft: 7, marginBottom: 5,
                      background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '4px 7px',
                      fontSize: 11, opacity: 0.85,
                    }}>
                      <div style={{ fontWeight: 800, color: '#fbbf24' }}>{msg.replyTo.username}</div>
                      <div style={{ color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{msg.replyTo.text}</div>
                    </div>
                  )}
                  {msg.text}
                </div>
                {canDelete && (
                  <button
                    onClick={() => handleDelete(msg.id)}
                    disabled={deleting === msg.id}
                    title="Delete message"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: 13, padding: '2px 4px', opacity: deleting === msg.id ? 0.4 : 1, lineHeight: 1 }}
                    onMouseEnter={e => e.currentTarget.style.color = '#f87171'}
                    onMouseLeave={e => e.currentTarget.style.color = '#475569'}
                  >🗑</button>
                )}
              </div>
              {hasChatAccess && (
                <div style={{ display: 'flex', gap: 4, marginTop: 3, paddingLeft: isMe ? 0 : 4, paddingRight: isMe ? 4 : 0 }}>
                  {['👍','❤️','❓'].map(em => {
                    const list = (msg.reactions && msg.reactions[em]) || [];
                    const reacted = list.map(u => u.toUpperCase()).includes(currentUser.toUpperCase());
                    return (
                      <button
                        key={em}
                        onClick={(e) => { e.stopPropagation(); toggleReaction(msg.id, em); }}
                        title={list.join(', ') || `React ${em}`}
                        style={{
                          background: reacted ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${reacted ? 'rgba(251,191,36,0.45)' : 'rgba(255,255,255,0.08)'}`,
                          borderRadius: 12, padding: '1px 7px', cursor: 'pointer', fontSize: 11,
                          color: '#cbd5e1', lineHeight: 1.4, display: 'inline-flex', alignItems: 'center', gap: 3,
                        }}
                      >
                        <span>{em}</span>
                        {list.length > 0 && <span style={{ fontWeight: 700, fontSize: 10, color: reacted ? '#fbbf24' : '#94a3b8' }}>{list.length}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {hasChatAccess ? (
        <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0, position: 'relative' }}>
          {showEmoji && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 12, right: 12, marginBottom: 6,
              background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12, padding: 10, display: 'flex', flexWrap: 'wrap', gap: 4, zIndex: 10,
              boxShadow: '0 -4px 20px rgba(0,0,0,0.4)',
            }}>
              {EMOJIS.map(e => (
                <button key={e} onClick={() => insertEmoji(e)} style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: 20,
                  padding: '3px 4px', borderRadius: 6, lineHeight: 1, transition: 'background .1s',
                }}
                  onMouseEnter={el => el.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                  onMouseLeave={el => el.currentTarget.style.background = 'none'}
                >{e}</button>
              ))}
            </div>
          )}
          {replyTo && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
              background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)',
              borderLeft: '3px solid rgba(251,191,36,0.7)', borderRadius: 8, padding: '6px 10px',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: 0.5 }}>Replying to {replyTo.username}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{replyTo.text}</div>
              </div>
              <button onClick={() => setReplyTo(null)} title="Cancel reply" style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 16, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>✕</button>
            </div>
          )}
          {error && <div style={{ fontSize: 11, color: '#f87171', marginBottom: 6 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setShowEmoji(s => !s)}
              title="Emoji"
              style={{
                background: showEmoji ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
                fontSize: 18, padding: '0 10px', cursor: 'pointer', alignSelf: 'stretch', lineHeight: 1,
              }}
            >😊</button>
            <textarea
              ref={textareaRef}
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
                background: sending || !text.trim() ? 'rgba(251,146,60,0.1)' : 'rgba(251,146,60,0.25)',
                border: '1px solid rgba(251,146,60,0.4)', borderRadius: 10,
                color: '#fdba74', fontWeight: 800, fontSize: 13,
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
