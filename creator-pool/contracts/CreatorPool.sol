// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Minimal ERC20 surface used by Creator Pool.
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title Creator Pool
/// @notice Sponsor-funded, fixed-reward creator campaigns. The sponsor alone decides which
/// submissions are approved. This contract holds and pays funds. It does not judge work.
///
/// Per-campaign accounting, in token atomic units:
///   funded    = total tokens received for the campaign, measured by actual balance change
///   committed = total of every approved reward, paid or not
///   paid      = rewards transferred to creators
///   refunded  = uncommitted funds returned to the sponsor at close
///   available = funded - committed - refunded  (free for new approvals or refund)
///   reserved  = committed - paid               (owed to approved creators)
///
/// Invariants:
///   funded <= budget
///   committed + refunded <= funded
///   paid <= committed
///   balanceOf(this) for each token >= liability[token], the sum of available + reserved
///
/// Time rules:
///   Funding and submissions require !closed and block.timestamp < deadline.
///   Funding after the deadline is not allowed.
///   Approval requires !closed. It stays allowed after the deadline so late review is possible.
///   Claims of approved rewards are always allowed, including after close.
///   close() is sponsor-only and final. It refunds exactly `available`.
contract CreatorPool {
    struct Campaign {
        address sponsor;
        address token;
        uint256 reward;
        uint256 budget;
        uint64 deadline;
        bool closed;
        bytes32 metaHash;
        uint256 funded;
        uint256 committed;
        uint256 paid;
        uint256 refunded;
    }

    struct Submission {
        uint256 campaignId;
        address creator;
        bytes32 contentHash;
        uint8 status;
    }

    uint8 public constant SUBMITTED = 1;
    uint8 public constant APPROVED = 2;
    uint8 public constant CLAIMED = 3;

    uint256 public campaignCount;
    uint256 public submissionCount;
    mapping(uint256 => Campaign) private _campaigns;
    mapping(uint256 => Submission) private _submissions;
    mapping(address => uint256) public liability;

    uint256 private _lock = 1;

    event CampaignCreated(uint256 indexed campaignId, address indexed sponsor, address token, uint256 reward, uint256 budget, uint64 deadline, bytes32 metaHash);
    event CampaignFunded(uint256 indexed campaignId, address indexed sponsor, uint256 amount, uint256 fundedTotal);
    event SubmissionCreated(uint256 indexed submissionId, uint256 indexed campaignId, address indexed creator, bytes32 contentHash);
    event SubmissionApproved(uint256 indexed submissionId, uint256 indexed campaignId, uint256 reward);
    event RewardClaimed(uint256 indexed submissionId, uint256 indexed campaignId, address indexed creator, uint256 amount);
    event CampaignClosed(uint256 indexed campaignId, uint256 refunded);

    modifier nonReentrant() {
        require(_lock == 1, "reentrant");
        _lock = 2;
        _;
        _lock = 1;
    }

    function getCampaign(uint256 campaignId) external view returns (Campaign memory) {
        return _campaigns[campaignId];
    }

    function getSubmission(uint256 submissionId) external view returns (Submission memory) {
        return _submissions[submissionId];
    }

    function available(uint256 campaignId) public view returns (uint256) {
        Campaign storage c = _campaigns[campaignId];
        return c.funded - c.committed - c.refunded;
    }

    function createCampaign(address token, uint256 reward, uint256 budget, uint64 deadline, bytes32 metaHash) external returns (uint256 id) {
        require(token.code.length > 0, "token not a contract");
        require(reward > 0 && budget >= reward, "bad amounts");
        require(deadline > block.timestamp, "deadline passed");
        id = ++campaignCount;
        Campaign storage c = _campaigns[id];
        c.sponsor = msg.sender;
        c.token = token;
        c.reward = reward;
        c.budget = budget;
        c.deadline = deadline;
        c.metaHash = metaHash;
        emit CampaignCreated(id, msg.sender, token, reward, budget, deadline, metaHash);
    }

    function fund(uint256 campaignId, uint256 amount) external nonReentrant {
        Campaign storage c = _campaigns[campaignId];
        require(c.sponsor == msg.sender, "not sponsor");
        require(!c.closed, "closed");
        require(block.timestamp < c.deadline, "deadline passed");
        require(amount > 0 && c.funded + amount <= c.budget, "exceeds budget");
        // Reserve the accounting first; any failure below reverts everything.
        c.funded += amount;
        liability[c.token] += amount;
        uint256 before = IERC20(c.token).balanceOf(address(this));
        _safeTransferFrom(c.token, msg.sender, address(this), amount);
        require(IERC20(c.token).balanceOf(address(this)) - before == amount, "unsupported token: received != amount");
        _checkSolvent(c.token);
        emit CampaignFunded(campaignId, msg.sender, amount, c.funded);
    }

    function submit(uint256 campaignId, bytes32 contentHash) external returns (uint256 id) {
        Campaign storage c = _campaigns[campaignId];
        require(c.sponsor != address(0), "no campaign");
        require(!c.closed, "closed");
        require(block.timestamp < c.deadline, "deadline passed");
        require(contentHash != bytes32(0), "empty content");
        id = ++submissionCount;
        _submissions[id] = Submission(campaignId, msg.sender, contentHash, SUBMITTED);
        emit SubmissionCreated(id, campaignId, msg.sender, contentHash);
    }

    function approve(uint256 submissionId) external {
        Submission storage s = _submissions[submissionId];
        require(s.status == SUBMITTED, "not pending");
        Campaign storage c = _campaigns[s.campaignId];
        require(c.sponsor == msg.sender, "not sponsor");
        require(!c.closed, "closed");
        require(c.funded - c.committed - c.refunded >= c.reward, "insufficient available budget");
        c.committed += c.reward;
        s.status = APPROVED;
        emit SubmissionApproved(submissionId, s.campaignId, c.reward);
    }

    function claim(uint256 submissionId) external nonReentrant {
        Submission storage s = _submissions[submissionId];
        require(s.creator == msg.sender, "not creator");
        require(s.status == APPROVED, "not claimable");
        Campaign storage c = _campaigns[s.campaignId];
        uint256 amount = c.reward;
        s.status = CLAIMED;
        c.paid += amount;
        liability[c.token] -= amount;
        _payOut(c.token, msg.sender, amount);
        emit RewardClaimed(submissionId, s.campaignId, msg.sender, amount);
    }

    function close(uint256 campaignId) external nonReentrant {
        Campaign storage c = _campaigns[campaignId];
        require(c.sponsor == msg.sender, "not sponsor");
        require(!c.closed, "closed");
        c.closed = true;
        uint256 amount = c.funded - c.committed - c.refunded;
        if (amount > 0) {
            c.refunded += amount;
            liability[c.token] -= amount;
            _payOut(c.token, msg.sender, amount);
        }
        emit CampaignClosed(campaignId, amount);
    }

    function _payOut(address token, address to, uint256 amount) private {
        uint256 before = IERC20(token).balanceOf(address(this));
        _safeTransfer(token, to, amount);
        require(before - IERC20(token).balanceOf(address(this)) == amount, "unsupported token: sent != amount");
        _checkSolvent(token);
    }

    function _checkSolvent(address token) private view {
        require(IERC20(token).balanceOf(address(this)) >= liability[token], "token balance below liability");
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "transfer failed");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount));
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "transferFrom failed");
    }
}
