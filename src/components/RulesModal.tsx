import React from 'react';

const RulesModal = ({ content, onAccept }: { content: string; onAccept: () => void }) => {
    return (
        <div className="modal">
            <div className="modal-content">
                <h3>Обновление правил</h3>
                <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid gray', padding: '1em' }}>
                    <pre>{content}</pre>
                </div>
                <button onClick={onAccept}>Ознакомлен</button>
            </div>
        </div>
    );
};

export default RulesModal;
