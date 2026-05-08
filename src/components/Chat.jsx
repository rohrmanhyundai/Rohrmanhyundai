import React, { useState, useEffect, useRef, useCallback } from 'react';
import { loadChatMessages, saveChatMessages } from '../utils/github';
import { getPusher, triggerEvent, ADVISOR_CHANNEL, NEW_MSG_EVENT } from '../utils/pusher';

const TYPING_PAUSE_MS = 2000;

// iMessage-inspired palette (advisor chat uses a teal accent for "me")
const ME_GRADIENT = 'linear-gradient(180deg,#3b82f6,#2563eb)';
const ME_TEXT     = '#ffffff';
const THEM_BG     = 'rgba(255,255,255,0.08)';
const THEM_TEXT   = '#e5e7eb';
const PANEL_BG    = 'rgba(15,23,42,0.92)';
const HEADER_BG   = 'rgba(15,23,42,0.96)';

export default function Chat({ currentUser, currentRole, hasChatAccess }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [activeMsgId, setActiveMsgId] = useState(null);
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
      const msgs = await loadChatMessages();
      setMessages(msgs);
    } catch {}
  }, []);

  useEffect(() => {
    fetchMessages();
    const channel = getPusher().subscribe(ADVISOR_CHANNEL);
    channel.bind(NEW_MSG_EVENT, () => {
      if (!isTypingRef.current) fetchMessages();
    });
    return () => { getPusher().unsubscribe(ADVISOR_CHANNEL); };
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
      const latest = await loadChatMessages();
      const newMsg = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        username: currentUser,
        text: trimmed,
        timestamp: Date.now(),
        ...(replyTo ? { replyTo: { id: replyTo.id, username: replyTo.username, text: replyTo.text.slice(0, 140) } } : {}),
      };
      const saved = await saveChatMessages([...latest, newMsg]);
      setMessages(saved);
      setText('');
      setReplyTo(null);
      isTypingRef.current = false;
      triggerEvent(ADVISOR_CHANNEL, NEW_MSG_EVENT);
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
      const latest = await loadChatMessages();
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
      const saved = await saveChatMessages(updated);
      setMessages(saved);
      triggerEvent(ADVISOR_CHANNEL, NEW_MSG_EVENT);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this message?')) return;
    setDeleting(id);
    setError('');
    try {
      const latest = await loadChatMessages();
      const updated = await saveChatMessages(latest.filter(m => m.id !== id));
      setMessages(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(null);
    }
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const yest = new Date(today); yest.setDate(today.getDate() - 1);
    const sameYest = d.toDateString() === yest.toDateString();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (sameDay) return time;
    if (sameYest) return `Yesterday ${time}`;
    const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${date} ${time}`;
  }

  const grouped = messages.reduce((acc, msg, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const isFirst = !prev || prev.username !== msg.username || msg.timestamp - prev.timestamp > 5 * 60 * 1000;
    const isLast  = !next || next.username !== msg.username || next.timestamp - msg.timestamp > 5 * 60 * 1000;
    acc.push({ ...msg, isFirst, isLast });
    return acc;
  }, []);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: PANEL_BG,
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 18, overflow: 'hidden', height: '100%',
      boxShadow: '0 4px 18px rgba(0,0,0,0.35)',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: HEADER_BG, flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, color: '#fff', fontWeight: 800,
          boxShadow: '0 2px 8px rgba(59,130,246,.4)',
        }}>💬</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#f1f5f9', letterSpacing: 0.1 }}>Advisor Chat</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>Group conversation · auto-clears after 30 days</div>
        </div>
      </div>

      {/* Messages */}
      <div className="chat-scroll" style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 6px', display: 'flex', flexDirection: 'column' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#475569', fontSize: 13, marginTop: 60 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>💬</div>
            No messages yet. Say hi!
          </div>
        )}
        {grouped.map(msg => {
          const isMe = msg.username.toUpperCase() === currentUser.toUpperCase();
          const isActive = activeMsgId === msg.id;
          const reactions = msg.reactions || {};
          const activeReactions = ['👍','❤️','❓','🚨'].filter(em => (reactions[em] || []).length > 0);
          const r = 18;
          const tail = 5;
          const radius = isMe
            ? `${r}px ${msg.isLast ? tail : r}px ${r}px ${r}px`
            : `${r}px ${r}px ${r}px ${msg.isLast ? tail : r}px`;
          return (
            <div key={msg.id} style={{
              display: 'flex', flexDirection: 'column',
              alignItems: isMe ? 'flex-end' : 'flex-start',
              marginTop: msg.isFirst ? 14 : 2,
              width: '100%',
            }}>
              {msg.isFirst && (
                <div style={{
                  fontSize: 11, color: '#64748b',
                  margin: isMe ? '0 6px 4px 0' : '0 0 4px 8px',
                  display: 'flex', gap: 6, alignItems: 'baseline',
                }}>
                  <span style={{ color: '#cbd5e1', fontWeight: 700 }}>{msg.username}</span>
                  <span>{fmtTime(msg.timestamp)}</span>
                </div>
              )}

              <div style={{
                display: 'flex', alignItems: 'flex-end', gap: 6,
                flexDirection: isMe ? 'row-reverse' : 'row',
                maxWidth: '94%',
                position: 'relative',
              }}>
                <div
                  onClick={() => setActiveMsgId(prev => prev === msg.id ? null : msg.id)}
                  onDoubleClick={() => hasChatAccess && setReplyTo({ id: msg.id, username: msg.username, text: msg.text })}
                  title={hasChatAccess ? 'Tap for actions, double-click to reply' : ''}
                  style={{
                    position: 'relative',
                    padding: '8px 13px',
                    borderRadius: radius,
                    background: isMe ? ME_GRADIENT : THEM_BG,
                    color: isMe ? ME_TEXT : THEM_TEXT,
                    fontSize: 14, lineHeight: 1.4,
                    wordBreak: 'break-word', whiteSpace: 'pre-wrap',
                    boxShadow: isMe ? '0 1px 2px rgba(37,99,235,.4)' : '0 1px 2px rgba(0,0,0,.25)',
                    cursor: hasChatAccess ? 'pointer' : 'default',
                    transition: 'transform .12s ease',
                    transform: isActive ? 'scale(1.02)' : 'scale(1)',
                  }}
                >
                  {msg.replyTo && (
                    <div style={{
                      borderLeft: `3px solid ${isMe ? 'rgba(255,255,255,0.6)' : 'rgba(251,191,36,0.7)'}`,
                      paddingLeft: 8, marginBottom: 6,
                      background: isMe ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
                      borderRadius: 6, padding: '5px 8px',
                      fontSize: 12, opacity: 0.92,
                    }}>
                      <div style={{ fontWeight: 700, color: isMe ? '#fef3c7' : '#fbbf24', fontSize: 11 }}>
                        {msg.replyTo.username}
                      </div>
                      <div style={{
                        color: isMe ? 'rgba(255,255,255,.85)' : '#94a3b8',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{msg.replyTo.text}</div>
                    </div>
                  )}
                  {msg.text}

                  {activeReactions.length > 0 && (
                    <div style={{
                      position: 'absolute',
                      bottom: -10,
                      [isMe ? 'left' : 'right']: 8,
                      background: '#1e293b',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 999,
                      padding: '2px 8px',
                      display: 'flex', gap: 4, alignItems: 'center',
                      fontSize: 12, lineHeight: 1, zIndex: 2,
                      boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                    }}>
                      {activeReactions.map(em => {
                        const cnt = reactions[em].length;
                        return (
                          <span key={em} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                            <span>{em}</span>
                            {cnt > 1 && <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8' }}>{cnt}</span>}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {hasChatAccess && isActive && (
                <div style={{
                  display: 'flex', gap: 6, marginTop: 8, alignItems: 'center',
                  paddingLeft: isMe ? 0 : 6, paddingRight: isMe ? 6 : 0,
                  flexDirection: isMe ? 'row-reverse' : 'row',
                }}>
                  {['👍','❤️','❓','🚨'].map(em => {
                    const list = reactions[em] || [];
                    const reacted = list.map(u => u.toUpperCase()).includes(currentUser.toUpperCase());
                    return (
                      <button
                        key={em}
                        onClick={(e) => { e.stopPropagation(); toggleReaction(msg.id, em); }}
                        title={list.join(', ') || `React ${em}`}
                        style={{
                          background: reacted ? 'rgba(59,130,246,0.22)' : 'rgba(255,255,255,0.05)',
                          border: `1px solid ${reacted ? 'rgba(96,165,250,0.5)' : 'rgba(255,255,255,0.08)'}`,
                          borderRadius: 999, padding: '3px 9px',
                          cursor: 'pointer', fontSize: 13, lineHeight: 1.2,
                          color: '#cbd5e1',
                        }}
                      >{em}</button>
                    );
                  })}
                  <button
                    onClick={(e) => { e.stopPropagation(); setReplyTo({ id: msg.id, username: msg.username, text: msg.text }); setActiveMsgId(null); }}
                    style={{
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 999, padding: '3px 11px', cursor: 'pointer',
                      fontSize: 12, fontWeight: 700, color: '#94a3b8',
                    }}
                  >↩ Reply</button>
                  {canDelete && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(msg.id); setActiveMsgId(null); }}
                      disabled={deleting === msg.id}
                      style={{
                        background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
                        borderRadius: 999, padding: '3px 11px', cursor: 'pointer',
                        fontSize: 12, fontWeight: 700, color: '#f87171',
                        opacity: deleting === msg.id ? 0.5 : 1,
                      }}
                    >{deleting === msg.id ? '⏳' : '🗑 Delete'}</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      {hasChatAccess ? (
        <div style={{
          padding: '10px 12px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: HEADER_BG,
          flexShrink: 0, position: 'relative',
        }}>
          {showEmoji && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 12, right: 12, marginBottom: 8,
              background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 14, padding: 10, display: 'flex', flexWrap: 'wrap', gap: 4, zIndex: 10,
              boxShadow: '0 -6px 24px rgba(0,0,0,0.5)',
            }}>
              {EMOJIS.map(e => (
                <button key={e} onClick={() => insertEmoji(e)} style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: 22,
                  padding: '4px 5px', borderRadius: 8, lineHeight: 1, transition: 'background .1s',
                }}
                  onMouseEnter={el => el.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                  onMouseLeave={el => el.currentTarget.style.background = 'none'}
                >{e}</button>
              ))}
            </div>
          )}
          {replyTo && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8,
              background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(96,165,250,0.3)',
              borderLeft: '3px solid #3b82f6', borderRadius: 10, padding: '6px 10px',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Replying to {replyTo.username}
                </div>
                <div style={{ fontSize: 12, color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {replyTo.text}
                </div>
              </div>
              <button onClick={() => setReplyTo(null)} title="Cancel reply" style={{
                background: 'none', border: 'none', color: '#94a3b8', fontSize: 16,
                cursor: 'pointer', padding: '0 4px', lineHeight: 1,
              }}>✕</button>
            </div>
          )}
          {error && <div style={{ fontSize: 11, color: '#f87171', marginBottom: 6 }}>{error}</div>}

          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: 8,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 22,
            padding: '4px 4px 4px 6px',
          }}>
            <button
              onClick={() => setShowEmoji(s => !s)}
              title="Emoji"
              style={{
                background: 'transparent', border: 'none',
                fontSize: 22, padding: '4px 6px',
                cursor: 'pointer', lineHeight: 1, color: '#94a3b8',
                borderRadius: 999,
              }}
            >😊</button>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              placeholder="iMessage"
              rows={1}
              style={{
                flex: 1, resize: 'none', background: 'transparent',
                border: 'none', outline: 'none',
                color: '#f1f5f9', padding: '8px 4px', fontSize: 14,
                fontFamily: 'inherit', lineHeight: 1.4, maxHeight: 120,
                minHeight: 22,
              }}
            />
            <button
              onClick={handleSend}
              disabled={sending || !text.trim()}
              title="Send"
              style={{
                width: 34, height: 34, borderRadius: '50%',
                background: text.trim() && !sending ? ME_GRADIENT : 'rgba(255,255,255,0.08)',
                border: 'none',
                color: '#fff', fontWeight: 800, fontSize: 16,
                cursor: text.trim() && !sending ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                transition: 'background .15s, transform .1s',
                transform: text.trim() && !sending ? 'scale(1)' : 'scale(0.92)',
                boxShadow: text.trim() && !sending ? '0 2px 6px rgba(37,99,235,.45)' : 'none',
              }}
            >
              {sending ? '…' : '↑'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{
          padding: '14px 16px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: HEADER_BG,
          fontSize: 12, color: '#475569', textAlign: 'center',
        }}>
          Chat access not enabled for your account
        </div>
      )}
    </div>
  );
}
