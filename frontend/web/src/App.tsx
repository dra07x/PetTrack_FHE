import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface PetLocationData {
  id: string;
  name: string;
  latitude: string;
  longitude: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [pets, setPets] = useState<PetLocationData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingPet, setAddingPet] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newPetData, setNewPetData] = useState({ name: "", latitude: "", longitude: "" });
  const [selectedPet, setSelectedPet] = useState<PetLocationData | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ latitude: number | null; longitude: number | null }>({ latitude: null, longitude: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>([37.7749, -122.4194]);
  const [mapZoom, setMapZoom] = useState(10);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM初始化失败" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const petsList: PetLocationData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          petsList.push({
            id: businessId,
            name: businessData.name,
            latitude: businessId,
            longitude: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading pet data:', e);
        }
      }
      
      setPets(petsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "加载数据失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const addPetLocation = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setAddingPet(true);
    setTransactionStatus({ visible: true, status: "pending", message: "使用Zama FHE添加宠物位置..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("获取合约失败");
      
      const latitudeValue = parseFloat(newPetData.latitude) * 1000000;
      const longitudeValue = parseFloat(newPetData.longitude) * 1000000;
      const businessId = `pet-${Date.now()}`;
      
      const encryptedLatitude = await encrypt(contractAddress, address, Math.round(latitudeValue));
      const encryptedLongitude = await encrypt(contractAddress, address, Math.round(longitudeValue));
      
      const tx = await contract.createBusinessData(
        businessId,
        newPetData.name,
        encryptedLatitude.encryptedData,
        encryptedLatitude.proof,
        Math.round(longitudeValue),
        0,
        "宠物位置数据"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "宠物位置添加成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowAddModal(false);
      setNewPetData({ name: "", latitude: "", longitude: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "用户取消了交易" 
        : "提交失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setAddingPet(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<{latitude: number, longitude: number} | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已在链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return {
          latitude: storedValue / 1000000,
          longitude: businessData.publicValue1 / 1000000
        };
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "在链上验证解密..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "数据解密验证成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return {
        latitude: Number(clearValue) / 1000000,
        longitude: businessData.publicValue1 / 1000000
      };
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已在链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "解密失败: " + (e.message || "未知错误") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const renderStats = () => {
    const totalPets = pets.length;
    const verifiedLocations = pets.filter(p => p.isVerified).length;
    const avgLatitude = pets.length > 0 
      ? pets.reduce((sum, p) => sum + p.publicValue1, 0) / pets.length 
      : 0;
    
    const recentLocations = pets.filter(p => 
      Date.now()/1000 - p.timestamp < 60 * 60 * 24
    ).length;

    return (
      <div className="stats-panels">
        <div className="panel">
          <h3>追踪宠物</h3>
          <div className="stat-value">{totalPets}</div>
          <div className="stat-trend">+{recentLocations} 今日新增</div>
        </div>
        
        <div className="panel">
          <h3>已验证位置</h3>
          <div className="stat-value">{verifiedLocations}/{totalPets}</div>
          <div className="stat-trend">链上验证</div>
        </div>
        
        <div className="panel">
          <h3>平均位置精度</h3>
          <div className="stat-value">{(avgLatitude/1000000).toFixed(6)}</div>
          <div className="stat-trend">FHE保护</div>
        </div>
      </div>
    );
  };

  const renderPetChart = (pet: PetLocationData) => {
    return (
      <div className="pet-chart">
        <div className="chart-row">
          <div className="chart-label">位置可信度</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${pet.isVerified ? 100 : 70}%` }}
            >
              <span className="bar-value">{pet.isVerified ? "100%" : "70%"}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">数据新鲜度</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${Math.min(100, 100 - (Date.now()/1000 - pet.timestamp)/(60 * 60 * 24)*10)}%` }}
            >
              <span className="bar-value">{Math.round(100 - (Date.now()/1000 - pet.timestamp)/(60 * 60 * 24)*10)}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">位置稳定性</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${Math.min(100, 80 + Math.random()*20)}%` }}
            >
              <span className="bar-value">{Math.round(80 + Math.random()*20)}%</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>位置加密</h4>
            <p>宠物位置数据使用Zama FHE加密 🔐</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>链上存储</h4>
            <p>加密数据存储在区块链上</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>离线解密</h4>
            <p>主人使用密钥离线解密位置数据</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">4</div>
          <div className="step-content">
            <h4>链上验证</h4>
            <p>提交证明进行链上验证</p>
          </div>
        </div>
      </div>
    );
  };

  const renderMap = () => {
    return (
      <div className="map-container">
        <div className="map-overlay">
          <div className="map-marker" style={{ top: '50%', left: '50%' }}>
            <div className="marker-pulse"></div>
            <div className="marker-icon">🐾</div>
          </div>
          
          {pets.map((pet, index) => {
            const lat = decryptedData.latitude || 0;
            const lng = decryptedData.longitude || 0;
            return (
              <div 
                key={index} 
                className={`map-marker ${selectedPet?.id === pet.id ? "selected" : ""}`}
                style={{ 
                  top: `${50 + (Math.random() - 0.5) * 20}%`, 
                  left: `${50 + (Math.random() - 0.5) * 20}%` 
                }}
                onClick={() => setSelectedPet(pet)}
              >
                <div className="marker-icon">🐶</div>
                <div className="marker-label">{pet.name}</div>
              </div>
            );
          })}
        </div>
        
        <div className="map-controls">
          <button onClick={() => setMapZoom(mapZoom + 1)}>+</button>
          <button onClick={() => setMapZoom(Math.max(5, mapZoom - 1))}>-</button>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>隐私宠物追踪 🔐</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🐾</div>
            <h2>连接钱包继续</h2>
            <p>请连接您的钱包以初始化加密宠物追踪系统。</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>使用上方按钮连接钱包</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE系统将自动初始化</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>开始追踪您的宠物位置</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>初始化FHE加密系统...</p>
        <p>状态: {fhevmInitializing ? "初始化FHEVM" : status}</p>
        <p className="loading-note">这可能需要一些时间</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加载加密宠物追踪系统...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>隐私宠物追踪 🔐</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowAddModal(true)} 
            className="create-btn"
          >
            + 添加宠物位置
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="left-panel">
          <div className="panel-section">
            <h2>宠物位置统计</h2>
            {renderStats()}
          </div>
          
          <div className="panel-section">
            <h2>宠物位置地图</h2>
            {renderMap()}
          </div>
        </div>
        
        <div className="right-panel">
          <div className="panel-section">
            <div className="section-header">
              <h2>宠物位置列表</h2>
              <div className="header-actions">
                <button 
                  onClick={loadData} 
                  className="refresh-btn" 
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "刷新中..." : "刷新"}
                </button>
              </div>
            </div>
            
            <div className="pets-list">
              {pets.length === 0 ? (
                <div className="no-pets">
                  <p>未找到宠物位置数据</p>
                  <button 
                    className="create-btn" 
                    onClick={() => setShowAddModal(true)}
                  >
                    添加第一个位置
                  </button>
                </div>
              ) : pets.map((pet, index) => (
                <div 
                  className={`pet-item ${selectedPet?.id === pet.id ? "selected" : ""} ${pet.isVerified ? "verified" : ""}`} 
                  key={index}
                  onClick={() => setSelectedPet(pet)}
                >
                  <div className="pet-name">{pet.name}</div>
                  <div className="pet-meta">
                    <span>时间: {new Date(pet.timestamp * 1000).toLocaleString()}</span>
                  </div>
                  <div className="pet-status">
                    状态: {pet.isVerified ? "✅ 已验证" : "🔓 待验证"}
                  </div>
                  <div className="pet-creator">主人: {pet.creator.substring(0, 6)}...{pet.creator.substring(38)}</div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="panel-section">
            <h2>FHE 🔐 解密流程</h2>
            {renderFHEFlow()}
          </div>
        </div>
      </div>
      
      {showAddModal && (
        <ModalAddPet 
          onSubmit={addPetLocation} 
          onClose={() => setShowAddModal(false)} 
          adding={addingPet} 
          petData={newPetData} 
          setPetData={setNewPetData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedPet && (
        <PetDetailModal 
          pet={selectedPet} 
          onClose={() => { 
            setSelectedPet(null); 
            setDecryptedData({ latitude: null, longitude: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedPet.id)}
          renderPetChart={renderPetChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalAddPet: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  adding: boolean;
  petData: any;
  setPetData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, adding, petData, setPetData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPetData({ ...petData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="add-pet-modal">
        <div className="modal-header">
          <h2>添加宠物位置</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 加密</strong>
            <p>位置数据将使用Zama FHE加密</p>
          </div>
          
          <div className="form-group">
            <label>宠物名称 *</label>
            <input 
              type="text" 
              name="name" 
              value={petData.name} 
              onChange={handleChange} 
              placeholder="输入宠物名称..." 
            />
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label>纬度 *</label>
              <input 
                type="number" 
                name="latitude" 
                value={petData.latitude} 
                onChange={handleChange} 
                placeholder="例如: 37.7749" 
                step="0.000001"
              />
              <div className="data-type-label">FHE加密数据</div>
            </div>
            
            <div className="form-group">
              <label>经度 *</label>
              <input 
                type="number" 
                name="longitude" 
                value={petData.longitude} 
                onChange={handleChange} 
                placeholder="例如: -122.4194" 
                step="0.000001"
              />
              <div className="data-type-label">公开数据</div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={adding || isEncrypting || !petData.name || !petData.latitude || !petData.longitude} 
            className="submit-btn"
          >
            {adding || isEncrypting ? "加密并添加中..." : "添加位置"}
          </button>
        </div>
      </div>
    </div>
  );
};

const PetDetailModal: React.FC<{
  pet: PetLocationData;
  onClose: () => void;
  decryptedData: { latitude: number | null; longitude: number | null };
  setDecryptedData: (value: { latitude: number | null; longitude: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<{latitude: number, longitude: number} | null>;
  renderPetChart: (pet: PetLocationData) => JSX.Element;
}> = ({ pet, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData, renderPetChart }) => {
  const handleDecrypt = async () => {
    if (decryptedData.latitude !== null) { 
      setDecryptedData({ latitude: null, longitude: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="pet-detail-modal">
        <div className="modal-header">
          <h2>宠物位置详情</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="pet-info">
            <div className="info-item">
              <span>宠物名称:</span>
              <strong>{pet.name}</strong>
            </div>
            <div className="info-item">
              <span>主人:</span>
              <strong>{pet.creator.substring(0, 6)}...{pet.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>记录时间:</span>
              <strong>{new Date(pet.timestamp * 1000).toLocaleString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>加密位置数据</h3>
            
            <div className="data-row">
              <div className="data-label">纬度:</div>
              <div className="data-value">
                {pet.isVerified && pet.decryptedValue ? 
                  `${pet.decryptedValue/1000000} (已验证)` : 
                  decryptedData.latitude !== null ? 
                  `${decryptedData.latitude} (已解密)` : 
                  "🔒 FHE加密数据"
                }
              </div>
              <button 
                className={`decrypt-btn ${(pet.isVerified || decryptedData.latitude !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 验证中..."
                ) : pet.isVerified ? (
                  "✅ 已验证"
                ) : decryptedData.latitude !== null ? (
                  "🔄 重新验证"
                ) : (
                  "🔓 验证解密"
                )}
              </button>
            </div>
            
            <div className="data-row">
              <div className="data-label">经度:</div>
              <div className="data-value">
                {pet.publicValue1/1000000} (公开数据)
              </div>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 隐私保护</strong>
                <p>宠物位置数据使用全同态加密技术保护，只有主人可以解密查看真实位置。</p>
              </div>
            </div>
          </div>
          
          {(pet.isVerified || decryptedData.latitude !== null) && (
            <div className="analysis-section">
              <h3>位置数据分析</h3>
              {renderPetChart(pet)}
              
              <div className="mini-map">
                <div className="map-marker" style={{ top: '50%', left: '50%' }}>
                  <div className="marker-icon">🐶</div>
                </div>
                <div className="map-coords">
                  <span>纬度: {pet.isVerified ? pet.decryptedValue!/1000000 : decryptedData.latitude}</span>
                  <span>经度: {pet.publicValue1/1000000}</span>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">关闭</button>
          {!pet.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "链上验证中..." : "链上验证"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


